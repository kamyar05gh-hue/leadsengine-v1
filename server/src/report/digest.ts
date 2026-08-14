/**
 * digest.ts — lightweight weekly/monthly digest PDF.
 *
 * The 1–2 page companion to the 9-page sales deck (template.ts): same dark
 * visual language (THEME, cards, purple/blue accents), stripped down to a
 * KPI strip, a progress mini-chart, a competitor comparison, and templated
 * "what changed" bullets. No LLM — all copy is plain template strings in the
 * company's language.
 *
 * Defensive by contract: missing scores/trends/snapshots never throw — the
 * affected section is skipped and the rest still renders.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'

import { PATHS } from '../config.js'
import {
  getCompany,
  insertReport,
  latestScore,
  latestTrackingSnapshot,
  listTrends,
} from '../db/repo.js'
import { collectClientSnapshot } from '../agents/datasetCollector.js'
import type { Company, TrendPoint, TrackingChanges } from '../types.js'
import { THEME, MM, groupedBarChart } from './charts.js'

type Doc = InstanceType<typeof PDFDocument>

export type DigestPeriod = 'weekly' | 'monthly'

const PERIOD_DAYS: Record<DigestPeriod, number> = { weekly: 7, monthly: 30 }
const TREND_POINTS: Record<DigestPeriod, number> = { weekly: 8, monthly: 6 }

// Deltas use the design-law pair (matches the dashboard), not THEME.GREEN.
const UP = '#3ECF8E'
const DOWN = '#F87171'

const W = 595.28 // A4 portrait, points
const H = 841.89
const MARGIN = 18 * MM
const CONTENT_TOP = 45 * MM
const CONTENT_BOTTOM = H - 22 * MM

const LOGO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'fm_logo.png',
)
const LOGO_RATIO = 546 / 105

// ─── formatting helpers ─────────────────────────────────────────────────────

/** Percent-scale value with 1–2 decimals, trailing zeros trimmed. */
function fmtPct(v: number): string {
  return v.toFixed(2).replace(/\.?0+$/, '')
}

/** Signed pp delta: explicit +, Unicode minus (U+2212), 1–2 decimals. */
function fmtDelta(d: number): string {
  return d >= 0 ? `+${fmtPct(d)}` : `\u2212${fmtPct(Math.abs(d))}`
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ─── copy (DE/EN template strings — no LLM) ─────────────────────────────────

interface DigestStrings {
  title: string
  kpiMention: string
  kpiCitation: string
  kpiSov: string
  noBaseline: string
  progress: string
  mentionSeries: string
  citationSeries: string
  competitors: string
  competitorNote: string
  changes: string
  noChanges: string
  methodology: string
}

function strings(lang: Company['language'], period: DigestPeriod): DigestStrings {
  if (lang === 'de') {
    return {
      title: `LeadEngine ${period === 'weekly' ? 'Weekly' : 'Monthly'} Digest`,
      kpiMention: 'MENTION-RATE',
      kpiCitation: 'ZITATIONS-RATE',
      kpiSov: 'SHARE OF VOICE',
      noBaseline: 'keine Baseline',
      progress: 'VERLAUF',
      mentionSeries: 'Mention',
      citationSeries: 'Zitation',
      competitors: 'REGIONALER WETTBEWERBSVERGLEICH',
      competitorNote: 'Erwähnungen in KI-Antworten (letztes Audit)',
      changes: 'WAS SICH GEÄNDERT HAT',
      noChanges: 'Keine nennenswerten Änderungen im Zeitraum.',
      methodology:
        'Methodik: Mention-/Zitationsraten aus KI-Antwort-Audits (ChatGPT, Gemini, Perplexity); Deltas vs. vorherigem Messpunkt. Wettbewerber-Balken: rohe Erwähnungen aus dem letzten Audit.',
    }
  }
  return {
    title: `LeadEngine ${period === 'weekly' ? 'Weekly' : 'Monthly'} Digest`,
    kpiMention: 'MENTION RATE',
    kpiCitation: 'CITATION RATE',
    kpiSov: 'SHARE OF VOICE',
    noBaseline: 'no baseline',
    progress: 'PROGRESS',
    mentionSeries: 'Mention',
    citationSeries: 'Citation',
    competitors: 'REGIONAL COMPETITOR COMPARISON',
    competitorNote: 'mentions in AI answers (latest audit)',
    changes: 'WHAT CHANGED',
    noChanges: 'No significant changes this period.',
    methodology:
      'Methodology: mention/citation rates from AI-answer audits (ChatGPT, Gemini, Perplexity); deltas vs. previous data point. Competitor bars: raw mentions from the latest audit.',
  }
}

/** "What changed" bullets from a tracking snapshot's diff payload. */
function changeBullets(changes: TrackingChanges, lang: Company['language']): string[] {
  const de = lang === 'de'
  const out: string[] = []
  if (changes.mentionRateChange !== null && changes.mentionRateChange !== 0) {
    const d = changes.mentionRateChange
    out.push(
      de
        ? `Mention-Rate ${d > 0 ? 'gestiegen' : 'gefallen'} (${fmtDelta(d)} pp) gegenüber der Vorwoche.`
        : `Mention rate ${d > 0 ? 'up' : 'down'} ${fmtDelta(d)} pp week over week.`,
    )
  }
  if (changes.citationRateChange !== null && changes.citationRateChange !== 0) {
    const d = changes.citationRateChange
    out.push(
      de
        ? `Zitations-Rate ${d > 0 ? 'gestiegen' : 'gefallen'} (${fmtDelta(d)} pp) gegenüber der Vorwoche.`
        : `Citation rate ${d > 0 ? 'up' : 'down'} ${fmtDelta(d)} pp week over week.`,
    )
  }
  if (
    changes.sentimentChange !== null &&
    changes.sentimentChange !== undefined &&
    changes.sentimentChange !== 0
  ) {
    const d = changes.sentimentChange
    out.push(
      de
        ? `Positiv-Anteil der Erwähnungen ${d > 0 ? 'gestiegen' : 'gefallen'} (${fmtDelta(d)} pp).`
        : `Positive-mention share ${d > 0 ? 'up' : 'down'} ${fmtDelta(d)} pp.`,
    )
  }
  for (const name of changes.newCompetitors.slice(0, 2)) {
    out.push(
      de
        ? `Neuer Wettbewerber in KI-Antworten: ${name}.`
        : `New competitor appeared in AI answers: ${name}.`,
    )
  }
  for (const name of changes.lostCompetitors.slice(0, 2)) {
    out.push(
      de
        ? `${name} wird nicht mehr in KI-Antworten erwähnt.`
        : `${name} disappeared from AI answers.`,
    )
  }
  if (out.length === 0) out.push(de ? strings('de', 'weekly').noChanges : strings('en', 'weekly').noChanges)
  return out.slice(0, 5)
}

// ─── layout primitives ──────────────────────────────────────────────────────

function writePdf(filePath: string, draw: (doc: Doc) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 })
    const stream = fs.createWriteStream(filePath)
    stream.on('finish', resolve)
    stream.on('error', reject)
    doc.on('error', reject)
    doc.pipe(stream)
    draw(doc)
    doc.end()
  })
}

interface Ctx {
  doc: Doc
  s: DigestStrings
  page: number
  y: number
}

/** Ensure `needed` mm of vertical space; start page 2 (never more) if short. */
function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.y + needed <= CONTENT_BOTTOM || ctx.page >= 2) return
  ctx.doc.addPage()
  ctx.doc.rect(0, 0, W, H).fill(THEME.BG)
  ctx.page += 1
  ctx.y = 20 * MM
  footer(ctx)
}

function footer(ctx: Ctx): void {
  ctx.doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(THEME.GRAY)
    .text(ctx.s.methodology, MARGIN, H - 14 * MM, {
      width: W - 2 * MARGIN - 15 * MM,
      lineBreak: false,
    })
    .text(String(ctx.page).padStart(2, '0'), MARGIN, H - 14 * MM, {
      width: W - 2 * MARGIN,
      align: 'right',
      lineBreak: false,
    })
}

function sectionLabel(ctx: Ctx, label: string): void {
  ctx.doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(THEME.GRAY)
    .text(label, MARGIN, ctx.y, { characterSpacing: 1.2, lineBreak: false })
  ctx.y += 6 * MM
}

// ─── sections ───────────────────────────────────────────────────────────────

interface Kpi {
  label: string
  value: number
  delta: number | null
}

function kpiStrip(ctx: Ctx, kpis: Kpi[]): void {
  const gap = 5 * MM
  const h = 25 * MM
  const w = (W - 2 * MARGIN - 2 * gap) / 3
  ensureSpace(ctx, h)
  kpis.forEach((kpi, i) => {
    const x = MARGIN + i * (w + gap)
    ctx.doc.roundedRect(x, ctx.y, w, h, 4).fill(THEME.CARD)
    ctx.doc.rect(x, ctx.y, w, 2.5).fill(THEME.PURPLE)
    ctx.doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(THEME.GRAY)
      .text(kpi.label, x + 4 * MM, ctx.y + 4 * MM, { width: w - 8 * MM, lineBreak: false })
    ctx.doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(THEME.WHITE)
      .text(`${fmtPct(kpi.value)}%`, x + 4 * MM, ctx.y + 9 * MM, {
        width: w - 8 * MM,
        lineBreak: false,
      })
    if (kpi.delta === null) {
      ctx.doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(THEME.GRAY)
        .text(`— ${ctx.s.noBaseline}`, x + 4 * MM, ctx.y + 18.5 * MM, { lineBreak: false })
    } else if (kpi.delta === 0) {
      ctx.doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(THEME.GRAY)
        .text('± 0 pp', x + 4 * MM, ctx.y + 18.5 * MM, { lineBreak: false })
    } else {
      const up = kpi.delta > 0
      ctx.doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(up ? UP : DOWN)
        .text(`${up ? '↑' : '↓'} ${fmtDelta(kpi.delta)} pp`, x + 4 * MM, ctx.y + 18.5 * MM, {
          lineBreak: false,
        })
    }
  })
  ctx.y += h + 8 * MM
}

function progressChart(ctx: Ctx, points: TrendPoint[]): void {
  if (points.length === 0) return
  const h = 52 * MM
  ensureSpace(ctx, 6 * MM + h)
  sectionLabel(ctx, ctx.s.progress)
  const categories = points.map((p) => p.at.slice(5, 10)) // MM-DD
  const data: Record<string, readonly number[]> = {}
  points.forEach((p, i) => {
    data[categories[i] ?? ''] = [p.mentionRate, p.citationRate]
  })
  groupedBarChart(
    ctx.doc,
    MARGIN,
    ctx.y,
    W - 2 * MARGIN,
    h,
    categories,
    [
      [ctx.s.mentionSeries, THEME.PURPLE],
      [ctx.s.citationSeries, THEME.BLUE],
    ],
    data,
  )
  ctx.y += h + 10 * MM
}

/** Horizontal bars: raw mention counts, client PURPLE, competitors GRAY. */
function competitorBars(ctx: Ctx, company: Company): void {
  const score = latestScore(company.id)
  if (!score) return
  // Regional scope first (the digest's declared scope); combined as fallback.
  const audit = score.payload.regional.competitors.length > 0 ? score.payload.regional : score.payload.combined
  const top = [...audit.competitors].sort((a, b) => b.rawHits - a.rawHits).slice(0, 3)
  if (top.length === 0) return
  const names = [company.name, ...company.aliases]
  const clientHits = names.reduce((sum, n) => sum + (audit.brandMentions[n] ?? 0), 0)
  const rows: [string, number, boolean][] = [
    [company.name, clientHits, true],
    ...top.map((c): [string, number, boolean] => [c.name, c.rawHits, false]),
  ]
  const rowH = 9 * MM
  const h = rows.length * rowH + 8 * MM
  ensureSpace(ctx, 6 * MM + h)
  sectionLabel(ctx, ctx.s.competitors)
  const maxv = Math.max(...rows.map((r) => r[1]), 1)
  const labelW = 48 * MM
  const valW = 16 * MM
  const barH = 3.5 * MM
  rows.forEach(([label, value, isClient], i) => {
    const cy = ctx.y + i * rowH
    ctx.doc
      .font(isClient ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .fillColor(isClient ? THEME.WHITE : THEME.LIGHT)
      .text(label.slice(0, 28), MARGIN, cy + barH / 2 - 3.5, {
        width: labelW - 4,
        lineBreak: false,
      })
    const bw = Math.max(((W - 2 * MARGIN - labelW - valW) * value) / maxv, 2)
    ctx.doc
      .roundedRect(MARGIN + labelW, cy, bw, barH, barH / 2)
      .fill(isClient ? THEME.PURPLE : THEME.GRAY)
    ctx.doc
      .font(isClient ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .fillColor(isClient ? THEME.BLUE : THEME.LIGHT)
      .text(String(value), MARGIN + labelW + bw + 6, cy + barH / 2 - 3.5, {
        width: valW,
        lineBreak: false,
      })
  })
  ctx.y += rows.length * rowH
  ctx.doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(THEME.GRAY)
    .text(ctx.s.competitorNote, MARGIN, ctx.y, { lineBreak: false })
  ctx.y += 8 * MM
}

function whatChanged(ctx: Ctx, company: Company): void {
  const snap = latestTrackingSnapshot(company.id)
  if (!snap) return
  const bullets = changeBullets(snap.changes, company.language)
  const h = bullets.length * 7 * MM + 8 * MM
  ensureSpace(ctx, 6 * MM + h)
  sectionLabel(ctx, ctx.s.changes)
  for (const b of bullets) {
    ctx.doc.circle(MARGIN + 2, ctx.y + 3.5, 1.6).fill(THEME.PURPLE)
    ctx.doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(THEME.LIGHT)
      .text(b, MARGIN + 6 * MM, ctx.y, { width: W - 2 * MARGIN - 6 * MM })
    ctx.y += ctx.doc.heightOfString(b, { width: W - 2 * MARGIN - 6 * MM }) + 3 * MM
  }
}

// ─── entry point ────────────────────────────────────────────────────────────

/**
 * Render the weekly/monthly digest PDF for a company, register it as a
 * 'digest' report row, and return the absolute file path.
 */
export async function generateDigest(companyId: string, period: DigestPeriod): Promise<string> {
  const company = getCompany(companyId)
  if (!company) throw new Error(`[digest] unknown company: ${companyId}`)

  const s = strings(company.language, period)
  const now = new Date()
  const start = new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000)
  const range = `${dayKey(start)} – ${dayKey(now)}`

  // Trend series: regional points when the scope exists, else everything.
  const allTrends = listTrends(companyId)
  const regional = allTrends.filter((t) => t.scope === 'regional')
  const series = (regional.length >= 2 ? regional : allTrends).slice(-TREND_POINTS[period])

  // KPI values: latest trend point when available, else the latest score.
  const score = latestScore(companyId)
  const latest = series[series.length - 1]
  const previous = series.length >= 2 ? series[series.length - 2] : undefined
  const overall = score?.payload.combined.overall
  const kpis: Kpi[] = [
    {
      label: s.kpiMention,
      value: latest?.mentionRate ?? overall?.mentionRate ?? 0,
      delta: latest && previous ? latest.mentionRate - previous.mentionRate : null,
    },
    {
      label: s.kpiCitation,
      value: latest?.citationRate ?? overall?.citationRate ?? 0,
      delta: latest && previous ? latest.citationRate - previous.citationRate : null,
    },
    {
      label: s.kpiSov,
      value: latest?.sov ?? overall?.sov ?? 0,
      delta: latest && previous ? latest.sov - previous.sov : null,
    },
  ]

  const dir = path.join(PATHS.reports, companyId)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `digest-${period}-${dayKey(now)}.pdf`)

  await writePdf(filePath, (doc) => {
    doc.rect(0, 0, W, H).fill(THEME.BG)
    const ctx: Ctx = { doc, s, page: 1, y: CONTENT_TOP }

    // Header: logo, purple rule, digest title, company + period range.
    if (fs.existsSync(LOGO)) {
      doc.image(LOGO, MARGIN, 9 * MM, { width: 22 * MM, height: (22 * MM) / LOGO_RATIO })
    } else {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(THEME.WHITE).text('LEADENGINE', MARGIN, 9 * MM)
    }
    doc
      .save()
      .lineWidth(0.7)
      .moveTo(MARGIN, 17 * MM)
      .lineTo(W - MARGIN, 17 * MM)
      .stroke(THEME.PURPLE)
      .restore()
    doc
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor(THEME.WHITE)
      .text(s.title, MARGIN, 23 * MM, { lineBreak: false })
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(THEME.LIGHT)
      .text(`${company.name} — ${range}`, MARGIN, 33 * MM, { lineBreak: false })
    footer(ctx)

    kpiStrip(ctx, kpis)
    progressChart(ctx, series)
    competitorBars(ctx, company)
    whatChanged(ctx, company)
  })

  insertReport({
    companyId,
    scope: 'regional',
    lang: company.language,
    kind: 'digest',
    path: filePath,
    createdAt: now.toISOString(),
  })

  // Monthly digests mark the client's monthly checkpoint — append the
  // LeadEngine Data row for it. Weekly digests are covered by the weekly
  // tracker's own snapshot, so they are not duplicated here. Best-effort:
  // a dataset failure must never lose a rendered digest.
  if (period === 'monthly') {
    try {
      collectClientSnapshot(companyId, 'monthly')
    } catch (err) {
      console.warn(`[digest] ${companyId}: dataset snapshot failed (non-fatal):`, err)
    }
  }

  return filePath
}
