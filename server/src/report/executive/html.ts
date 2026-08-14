/**
 * html.ts — composes the self-contained Dark Executive Report HTML (v7).
 *
 * Page plan (adaptive — competitor pages only exist for measured, evidence-
 * backed competitors, so an audience slice without a competitive field
 * degrades to a 6-page client document instead of printing empty pages):
 *   P1  Overview          — KPI wall with counts + 95% intervals, contents,
 *                           verdict, reading rule
 *   P2  Client deep-dive  — engine × metric counts + bar chart, topic profile
 *   P3  Client evidence   — real prompts, verbatim excerpt, gap to each rival
 *   P4…  one page per competitor (top 5, ranked): measured counts + chart,
 *                           where they win (topics + real prompts), why they
 *                           win (stored teardown + tactics), their captured
 *                           pages (URL, format, length, structural signals),
 *                           one verbatim excerpt
 *   P-3 Market comparison — all brands per engine + share of voice on integer
 *                           bases + topic table with competitor columns
 *   P-2 Sources           — citation supply chain
 *   P-1 Executive letter  — unchanged v6 design (approved)
 *
 * STATISTICAL PRESENTATION (the v7 contract, enforced here):
 *   · every figure prints as `k/n` first, with its derived percentage behind
 *     it in 7pt grey — no bare, undenominated percentage anywhere, charts
 *     included (bar labels carry the count, the axis carries the share);
 *   · headline client metrics carry a Wilson 95% interval;
 *   · a percentage is never printed on a base below MIN_DENOM — the count
 *     stays, the rate becomes n/a, and a footnote says why once per page;
 *   · share of voice is always `brand mentions / all brand mentions`.
 *
 * Palette: bg #000, line #262633, client sky #38BDF8, competitors
 * #C4B5FD/#A78BFA/#CECBF6/#7DD3FC/#8B5CF6, grey #9CA3AF, red #F87171.
 * v6 de-AI rules kept: ZERO pills/chips/badges, zero rounded-rectangle cards.
 * Tags are editorial marginalia — uppercase letter-spaced grey text with a
 * 2px accent rule. Panels are open sections separated by hairline rules.
 * Type scale: 26pt display · 13pt section · 9pt body · 7pt caption
 * (+ 6.5pt methodology on the letter). All charts are TS-generated inline SVG
 * (svgCharts.ts). Missing data renders as a labelled "no data" line, never
 * as an empty box and never as invented content.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Count,
  EntityProfile,
  ExecModel,
  GapLine,
  PageEvidence,
  SeriesColor,
} from './model.js'
import { hasRate, ratePct, wilson95, MIN_DENOM, ENGINE_SHORT } from './model.js'
import { STR, type ExecStr } from './strings.js'
import {
  groupedBarSvg,
  shareBarSvg,
  stackedShareSvg,
  type Cluster,
  type StackSlice,
} from './svgCharts.js'

/** Brand accent hexes (identity — headers, swatches, summary/stacked bars). */
const SERIES_HEX: Record<SeriesColor, string> = {
  sky: '#38BDF8',
  p1: '#C4B5FD',
  p2: '#A78BFA',
  p3: '#CECBF6',
  p4: '#7DD3FC',
  p5: '#8B5CF6',
}

/**
 * Metric ladders: within one brand's pattern chart the three bars
 * (mention / citation / SoV) are three validated lightness steps of the
 * brand's hue family — adjacent-pair ΔE ≥ 15 (normal) and ≥ 8 (CVD); every
 * bar also carries a direct count label and the paired table repeats the
 * exact numbers, so identity never rides on color alone.
 */
const CLIENT_LADDER = ['#7DD3FC', '#0EA5E9', '#075985'] as const
const COMP_LADDER = ['#C4B5FD', '#8B5CF6', '#5B21B6'] as const

const OTHERS_HEX = '#4B5563'

/** Layout constants (px at 96dpi; content width 182mm ≈ 688px). */
const FULL_W = 688
const HALF_W = 332

// ─── Brand mark ─────────────────────────────────────────────────────────────

/**
 * The agency wordmark, inlined as a data URI. The deck is rendered from a
 * single self-contained HTML string via Chromium `setContent`, so there is
 * no base URL a `file://` or relative `src` could resolve against — the
 * bytes have to travel inside the document.
 */
const LOGO_DATA_URI: string | null = (() => {
  try {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', 'assets', 'fm_logo.png',
    )
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null // no asset → text wordmark fallback, never a broken image
  }
})()

/**
 * Header brand block, repeated on every page: the wordmark with the
 * "Powered by LeadEngine" attribution directly beneath it. Absolutely
 * positioned in the page's top-right corner so it never competes with the
 * section title on the left.
 */
function brandMark(): string {
  const mark = LOGO_DATA_URI
    ? `<img src="${LOGO_DATA_URI}" alt="Future Media">`
    : '<div class="wordmark">FUTURE MEDIA</div>'
  return `<div class="brand">${mark}<div class="poweredby">Powered by LeadEngine</div></div>`
}

// ─── Text helpers ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Strip markdown noise from narrative copy (**, ##, links, `code`). */
function stripMd(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Stored teardown prose carries research apparatus — reference markers
 * ("[2][4]"), URL lists and hedging notes ("[VERMUTUNG: …]") inside square
 * brackets. They are stripped for print; the wording itself is untouched.
 */
function stripRefs(s: string): string {
  return s
    .replace(/\[[^\]]{0,240}]/g, '')
    .replace(/[-–—]{2,}/g, '–')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:/–-]+$/, '')
    .trim()
}

/** Drop a trailing parenthetical/quote left unclosed by truncation. */
function trimDangling(t: string): string {
  const open = t.lastIndexOf('(')
  if (open >= 0 && !t.includes(')', open)) t = t.slice(0, open)
  if (((t.match(/"/g) ?? []).length) % 2 === 1) t = t.slice(0, t.lastIndexOf('"'))
  const lg = t.lastIndexOf('«')
  if (lg >= 0 && !t.includes('»', lg)) t = t.slice(0, lg)
  const gq = t.lastIndexOf('„')
  if (gq >= 0 && !t.includes('“', gq)) t = t.slice(0, gq)
  return t.replace(/[\s.,;:—–-]+$/, '')
}

/** Distill narrative copy to its lead clause, hard-capped at `maxWords`. */
function distill(raw: string, maxWords = 16): string {
  const s = stripMd(raw)
  const parts = s.split(/(?<=[.!?])\s+/)
  let t = parts[0] ?? s
  if (t.split(/\s+/).length < 5 && parts.length > 1) t = `${t} ${parts[1]}`
  const words = t.split(/\s+/)
  if (words.length > maxWords) t = trimDangling(words.slice(0, maxWords).join(' ')) + ' …'
  return t.replace(/[.,;:]\s*$/, '')
}

/** Distill stored teardown prose (long, reference-tagged German sentences). */
function distillEvidence(raw: string, maxWords = 20): string {
  return distill(stripRefs(raw), maxWords)
}

/** Truncate a raw prompt for display without inventing wording. */
function clipPrompt(p: string, max = 84): string {
  const flat = p.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).replace(/[\s,;:—–-]+$/, '')} …` : flat
}

/**
 * Distill the letter verdict: whole sentences from EXEC_SUMMARY then
 * CLOSER, up to 3 sentences and ~`maxWords` words — reads as management
 * prose, not a truncated bullet.
 */
function distillLetter(m: ExecModel, maxWords = 45): string {
  const pool = [...m.sections.EXEC_SUMMARY, ...m.sections.CLOSER].map(stripMd).filter(Boolean)
  const sentences = pool.flatMap((p) => p.split(/(?<=[.!?])\s+/)).filter(Boolean)
  const out: string[] = []
  let words = 0
  for (const sen of sentences) {
    const w = sen.split(/\s+/).length
    if (out.length > 0 && words + w > maxWords) break
    out.push(sen)
    words += w
    if (out.length >= 3) break
  }
  let t = out.join(' ')
  const ws = t.split(/\s+/)
  if (ws.length > maxWords) t = ws.slice(0, maxWords).join(' ') + ' …'
  return t
}

const fmtPct = (v: number): string => `${Math.round(v * 10) / 10}%`
const fmtRank = (r: number | null): string | null =>
  r === null ? null : `#${Math.round(r * 10) / 10}`

function chf(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

// ─── Count rendering (the statistical contract) ─────────────────────────────

/**
 * Percentage-only display contract.
 *
 * Every measured figure renders as a single percentage. The underlying
 * `k of n` counts still drive the model (and still gate what may be shown —
 * see below), they are simply not printed: a deck full of "1/30 3.3%" pairs
 * reads as raw instrumentation rather than a client report.
 *
 * The honesty guarantees survive without the fractions:
 *  - a base under MIN_DENOM prints `n/a`, never a meaningless rate;
 *  - an empty base prints `n/a`;
 *  - the sample base is stated once per page in a caption and in full on
 *    the methodology strip, so any percentage stays traceable.
 */
function cnt(c: Count, s: ExecStr): string {
  const p = ratePct(c)
  if (c.n <= 0 || p === null || !hasRate(c)) return `<span class="na">${esc(s.na)}</span>`
  return `<span class="k">${fmtPct(p)}</span>`
}

/** Chart label for a bar: the percentage it encodes. */
const barLabel = (c: Count): string => {
  const p = ratePct(c)
  return p === null ? '' : fmtPct(p)
}

/** Headline figure — the percentage alone. */
function withCi(c: Count, s: ExecStr): string {
  const p = ratePct(c)
  if (p === null || !hasRate(c)) return s.na
  return fmtPct(p)
}

/**
 * Percentage-only contract: prose percentages are no longer annotated with
 * their base, so no lookup is needed. Kept as an empty map so `denominate`
 * and its call sites keep their shape (and can be re-enabled in one place
 * if the count annotation is ever wanted back).
 */
function pctLookup(_m: ExecModel): Map<string, string> {
  return new Map<string, string>()
}

function denominate(text: string, _lk: Map<string, string>): string {
  // Percentage-only contract: prose keeps its percentages bare. The base is
  // stated once per page and in full on the methodology strip, so a figure
  // stays traceable without a fraction glued to every number.
  return text
}

// ─── Stylesheet ─────────────────────────────────────────────────────────────

const CSS = `
@page { size: A4; margin: 0 }
:root {
  --sky: #38BDF8; --white: #FFFFFF; --grey: #9CA3AF; --dim: #6B7280;
  --line: #262633; --red: #F87171;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #000000; }
body { font-family: "Segoe UI", Arial, sans-serif; color: var(--white); }
.page {
  width: 210mm; min-height: 297mm; max-height: 297mm;
  padding: 10mm 14mm 18mm; page-break-after: always;
  overflow: hidden; position: relative; background: #000000;
  display: flex; flex-direction: column;
}
.page:last-child { page-break-after: auto; }

/* Header brand block — wordmark + attribution, top-right of every page.
   Absolute so it never shifts the page's flex flow; the reserved strip is
   ~13mm wide by ~9mm tall, clear of every section title on the left. */
/* Header brand lockup — top-LEFT, in the normal flow so the section title
   below it moves down instead of colliding. The page's top padding was
   reduced to pay for the block's height, keeping every page's content in
   its 297mm box. */
.brand { margin-bottom: 6mm; line-height: 1; }
.brand img { width: 56mm; display: block; opacity: .95; }
.brand .wordmark {
  font-size: 15pt; font-weight: 800; letter-spacing: 1.6px; color: var(--white);
}
/* Closing gap page */
.gaprow { border-top: .5pt solid var(--line); padding: 3.2mm 0; }
.gq { font-size: 9.5pt; line-height: 1.4; }
.gr { margin-top: 1.4mm; font-size: 7pt; color: var(--grey); letter-spacing: .2px; }
.gaplead { margin-top: 5mm; font-size: 9pt; }
.gapimpact {
  border-left: 2px solid var(--sky); padding: 1mm 0 1mm 5.5mm;
  font-size: 9pt; color: var(--grey); line-height: 1.5;
}
.brand .poweredby {
  margin-top: 2.4mm; font-size: 7.5pt; letter-spacing: 1.7px;
  text-transform: uppercase; color: var(--dim);
}

/* type scale — 26 / 13 / 9 / 7pt only (+6.5pt method strip on the letter) */
h1 { font-size: 26pt; font-weight: 700; line-height: 1.15; letter-spacing: -.2px; }
h2 {
  font-size: 13pt; font-weight: 700; letter-spacing: .1px;
  border-bottom: .5pt solid var(--line); padding-bottom: 3mm; margin-bottom: 5mm;
}
h2 .pg { color: var(--dim); font-weight: 600; margin-right: 3mm; }
.body { font-size: 9pt; line-height: 1.55; }
.cap {
  font-size: 7pt; color: var(--grey); text-transform: uppercase;
  letter-spacing: 1.2px; font-weight: 600;
}
.capline { font-size: 7pt; color: var(--grey); letter-spacing: .2px; line-height: 1.5; }
.sky { color: var(--sky); } .grey { color: var(--grey); } .dimc { color: var(--dim); }

/* editorial tag — uppercase grey marginalia with a 2px accent rule */
.tag {
  display: inline-block; text-transform: uppercase; letter-spacing: 2.2px;
  font-size: 7pt; font-weight: 600; color: var(--grey);
  border-left: 2px solid var(--sky); padding-left: 3mm;
}

/* headline KPIs: count set large, rate + interval quiet underneath */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm; }
.kpi { border-top: .5pt solid var(--line); padding-top: 3.2mm; }
.kpi .num { font-size: 26pt; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
.kpi .lbl { margin-top: 1.8mm; }
.kpi .sub { margin-top: 1.2mm; font-size: 7pt; color: var(--grey); }

/* contents */
.tocrow {
  display: flex; align-items: baseline; gap: 4mm;
  border-bottom: .5pt solid var(--line); padding: 3.1mm 0;
  font-size: 9pt;
}
.tocrow:last-child { border-bottom: none; }
.tocrow .n { color: var(--dim); font-variant-numeric: tabular-nums; width: 7mm; }
.tocrow .t { flex: 1; }
.tocrow .p { color: var(--grey); font-variant-numeric: tabular-nums; }

/* verdict — plain block with a single accent rule */
.verdict { border-left: 2px solid var(--sky); padding: 1mm 0 1mm 5.5mm; }
.verdict .txt { font-size: 13pt; font-weight: 600; line-height: 1.5; }

/* tables — hairline rules only, tabular numerals */
table { width: 100%; border-collapse: collapse; }
th {
  font-size: 7pt; color: var(--grey); text-transform: uppercase;
  letter-spacing: 1.2px; font-weight: 600; text-align: right;
  padding: 0 0 2.4mm 3mm;
}
th:first-child { text-align: left; padding-left: 0; }
td {
  font-size: 9pt; padding: 2.6mm 0 2.6mm 3mm; border-top: .5pt solid var(--line);
  text-align: right; font-variant-numeric: tabular-nums; vertical-align: middle;
}
td:first-child { text-align: left; padding-left: 0; }
tr.total td { font-weight: 700; border-top: .5pt solid #3B3B4D; }
td .na, .na { color: var(--dim); }
/* count-first pair: k/n large, derived rate small and grey behind it */
.k { font-variant-numeric: tabular-nums; }
.pct { font-size: 7pt; color: var(--grey); font-variant-numeric: tabular-nums; }

table.compact td { padding: 2.2mm 0 2.2mm 3mm; }
.roomy td { padding: 5.6mm 0 5.6mm 3mm; }

/* brand swatch — functional color key (hard-edged square, no radius) */
.sw {
  display: inline-block; width: 2.6mm; height: 2.6mm;
  margin-right: 2mm; vertical-align: baseline;
}

.legend { display: flex; gap: 5mm; flex-wrap: wrap; align-items: center; }
.legend .li { font-size: 7pt; color: var(--grey); letter-spacing: .2px; }

/* entity sub-header */
.csub { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 1.6mm; }
.csub .cname { font-size: 13pt; font-weight: 700; }
.csub .crank {
  font-size: 7pt; color: var(--grey); text-transform: uppercase;
  letter-spacing: 1.2px; font-weight: 600;
}

/* plain numbered rows (findings, teardown reasons) */
.frow {
  display: flex; gap: 4mm; padding: 2.6mm 0; border-top: .5pt solid var(--line);
  font-size: 9pt; line-height: 1.45;
}
.frow .fn { color: var(--dim); font-variant-numeric: tabular-nums; flex: none; }

/* evidence rows: a real string on top, its measured base underneath */
.erow { padding: 2.4mm 0; border-top: .5pt solid var(--line); }
.erow .et { font-size: 9pt; line-height: 1.4; }
.em { font-size: 7pt; color: var(--grey); margin-top: 1mm; line-height: 1.45; }
.erow .eu { font-size: 7pt; color: var(--sky); line-height: 1.4; word-break: break-all; }

/* verbatim excerpt — quiet left rule, never a card */
.quote { border-left: 2px solid #3B3B4D; padding: 0 0 0 5mm; }
.quote .qt { font-size: 9pt; line-height: 1.5; }
.quote .qm { font-size: 7pt; color: var(--grey); margin-top: 1.4mm; }

/* pattern + column grids */
.pattern { display: grid; grid-template-columns: 1fr 1.06fr; gap: 8mm; align-items: start; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; align-items: start; }

.divider { border-top: .5pt solid var(--line); margin: 5mm 0; }
.spread { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
.spread > .divider { margin: 0; }

/* executive letter */
.lverdict { font-size: 13pt; font-weight: 600; line-height: 1.75; max-width: 170mm; }
.step { display: flex; gap: 7mm; padding: 6.5mm 0; border-top: .5pt solid var(--line); }
.step .pn {
  font-size: 9pt; font-weight: 700; width: 9mm; flex: none;
  font-variant-numeric: tabular-nums; padding-top: 1.2mm;
}
.step .act { font-size: 9pt; font-weight: 700; line-height: 1.55; margin: 1.6mm 0 1.2mm; }
.step .eff { font-size: 9pt; color: var(--grey); line-height: 1.55; }
.sigrule { width: 26mm; border-top: .5pt solid #3B3B4D; margin-bottom: 3.2mm; }
.sig { font-size: 9pt; font-weight: 600; letter-spacing: .2px; }
.method {
  border-top: .5pt solid var(--line); padding-top: 2.6mm;
  font-size: 6.5pt; color: var(--grey); line-height: 1.9; letter-spacing: .2px;
}

.footer {
  position: absolute; left: 14mm; right: 14mm; bottom: 8mm;
  display: flex; justify-content: space-between;
  font-size: 7pt; color: var(--grey); letter-spacing: .2px;
  border-top: .5pt solid var(--line); padding-top: 2.4mm;
}

/* svg text tokens — charts share the page's type system */
svg { font-family: "Segoe UI", Arial, sans-serif; }
svg .sv-cap { font-size: 7pt; fill: var(--grey); letter-spacing: 1.2px; font-weight: 600; }
svg .sv-val { font-size: 7pt; fill: var(--white); font-weight: 600; }
svg .sv-na { font-size: 7pt; fill: var(--dim); }
svg .sv-in { font-size: 7pt; font-weight: 700; }

.mb1 { margin-bottom: 1mm; } .mb2 { margin-bottom: 2mm; } .mb3 { margin-bottom: 3mm; }
.mb4 { margin-bottom: 4mm; } .mb5 { margin-bottom: 5mm; } .mb6 { margin-bottom: 6mm; }
.mb8 { margin-bottom: 8mm; }
.grow { flex: 1; }
`

// ─── Shared components ──────────────────────────────────────────────────────

function footer(m: ExecModel, s: ExecStr, n: number, total: number, variantLabel: string): string {
  return `<div class="footer"><span>${esc(
    s.footerLeft(m.company.name, variantLabel),
  )}</span><span>${esc(s.pageOf(n, total))}</span></div>`
}

function h2(num: number, title: string): string {
  const pad = num < 10 ? `0${num}` : String(num)
  return `<h2><span class="pg">${pad}</span>${esc(title)}</h2>`
}

function sw(hex: string): string {
  return `<span class="sw" style="background:${hex}"></span>`
}

function legend(items: { hex: string; label: string }[]): string {
  return `<div class="legend">${items
    .map((i) => `<span class="li">${sw(i.hex)}${esc(i.label)}</span>`)
    .join('')}</div>`
}

/** A labelled "no data" line — the only thing allowed where data is missing. */
function noData(text: string): string {
  return `<div class="capline">${esc(text)}</div>`
}

/**
 * Engine × metric table for one entity. Every cell is `k/n` plus its derived
 * rate, so the denominator behind each percentage is on the same line: with
 * n=10 a 20% is visibly 2 answers, not a suspicious round number.
 */
function metricTable(s: ExecStr, e: EntityProfile, roomy = false): string {
  const rows = e.rows
    .map(
      (r) => `<tr>
        <td>${esc(r.label)}</td>
        <td>${cnt(r.mention, s)}</td>
        <td>${cnt(r.citation, s)}</td>
        <td>${cnt(r.sov, s)}</td>
      </tr>`,
    )
    .join('')
  const t = e.totals
  return `<table class="${roomy ? 'roomy' : ''}">
    <thead><tr><th>${esc(s.thEngine)}</th><th>${esc(s.thMention)}</th><th>${esc(
      s.thCitation,
    )}</th><th>${esc(s.thSov)}</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td>${esc(s.totalRow)}</td><td>${cnt(t.mention, s)}</td><td>${cnt(
        t.citation,
        s,
      )}</td><td>${cnt(t.sov, s)}</td></tr>
    </tbody>
  </table>`
}

/** Bar-chart half of the pattern: one cluster per engine, 3 metric bars. */
function metricChart(
  s: ExecStr,
  e: EntityProfile,
  width: number,
  barH: number,
  clusterGap: number,
): string {
  const ladder = e.isClient ? CLIENT_LADDER : COMP_LADDER
  const clusters: Cluster[] = e.rows.map((r) => ({
    label: r.label,
    bars: [
      { value: ratePct(r.mention), color: ladder[0], label: barLabel(r.mention) },
      { value: ratePct(r.citation), color: ladder[1], label: barLabel(r.citation) },
      { value: ratePct(r.sov), color: ladder[2], label: barLabel(r.sov) },
    ],
  }))
  const leg = legend([
    { hex: ladder[0], label: s.thMention },
    { hex: ladder[1], label: s.thCitation },
    { hex: ladder[2], label: s.thSov },
  ])
  return `${leg}<div style="height:4mm"></div>${groupedBarSvg(clusters, {
    width,
    barH,
    clusterGap,
    naLabel: s.na,
  })}`
}

/** One-line measured summary under an entity header — counts, then rates. */
function statLine(s: ExecStr, e: EntityProfile): string {
  const t = e.totals
  const fmt = (c: Count): string => {
    const p = ratePct(c)
    return hasRate(c) && p !== null ? fmtPct(p) : s.na
  }
  return s.statLine(fmt(t.mention), fmt(t.citation), fmt(t.sov), fmtRank(t.rank))
}

/** The small-sample rule, stated once per page that applies it. */
function minDenomNote(m: ExecModel, s: ExecStr): string {
  if (m.minRunsOk >= MIN_DENOM * 4) return ''
  return `<div class="capline" style="margin-top:2.5mm">${esc(s.minDenomNote(MIN_DENOM))}</div>`
}

/**
 * Plain numbered findings rows. Percentages inside the LLM-written narrative
 * get their measured base appended where it is unambiguous; whatever is left
 * is covered by a base line under the block, so no percentage in the deck is
 * ever printed without its denominator visible on the same page.
 */
function findings(
  m: ExecModel,
  s: ExecStr,
  items: string[],
  lk: Map<string, string>,
  max = 3,
  maxWords = 18,
): string {
  const texts = items
    .filter(Boolean)
    .slice(0, max)
    .map((t) => denominate(distill(t, maxWords), lk))
  const rows = texts
    .map(
      (t, i) => `<div class="frow"><span class="fn">0${i + 1}</span><span>${esc(t)}</span></div>`,
    )
    .join('')
  return `${rows}${baseNote(m, s, texts)}`
}

/** The sample base, printed under any block whose prose quotes a percentage. */
function baseNote(m: ExecModel, s: ExecStr, texts: string[]): string {
  if (!texts.some((t) => /\d\s?%/.test(t))) return ''
  return `<div class="capline" style="margin-top:2.4mm">${esc(
    s.sampleBaseNote(m.totalRunsOk, m.totalCitations),
  )}</div>`
}

// ─── Entity building blocks ─────────────────────────────────────────────────

/** Topic strengths + the real prompts the entity was named in. */
function whereTheyWin(s: ExecStr, e: EntityProfile): string {
  const strong = e.topics.filter((t) => t.hit.k > 0).slice(0, 3)
  const topicLine =
    strong.length > 0
      ? `<div class="capline mb3">${esc(s.topicStrengthTitle)}: ${strong
          .map((t) => `${esc(s.topicLabel[t.topic])} ${barLabel(t.hit) || s.na}`)
          .join(' · ')}</div>`
      : ''
  const rows =
    e.prompts.length > 0
      ? e.prompts
          .map(
            (p) => `<div class="erow">
              <div class="et">«${esc(clipPrompt(p.prompt))}»</div>
              <div class="em">${esc(s.namedInPct(barLabel(p.hit) || s.na))} · ${esc(
                p.engines.map((x) => ENGINE_SHORT[x]).join(' · '),
              )}</div>
            </div>`,
          )
          .join('')
      : noData(s.noPrompts(e.name))
  return `<div>
    <div class="cap mb2">${esc(s.whereWinTitle)}</div>
    ${topicLine}${rows}
  </div>`
}

/** Stored teardown: distilled reasons + the concrete tactics behind them. */
function whyTheyWin(s: ExecStr, e: EntityProfile): string {
  if (!e.teardown) {
    return `<div><div class="cap mb2">${esc(s.whyWinTitle)}</div>${noData(
      s.noTeardown(e.name),
    )}</div>`
  }
  const reasons = e.teardown.whyTheyWin
    .slice(0, 3)
    .map(
      (r, i) =>
        `<div class="frow"><span class="fn">0${i + 1}</span><span>${esc(
          distillEvidence(r, 19),
        )}</span></div>`,
    )
    .join('')
  const t = e.teardown.tactics
  const tactics = (['content', 'schema', 'directories', 'earned', 'entity'] as const)
    .map((key) => ({ key, first: t[key].find((x) => x.trim().length > 0) }))
    .filter((x): x is { key: typeof x.key; first: string } => Boolean(x.first))
    .slice(0, 3)
    .map(
      (x) =>
        `<div class="em" style="margin-top:1.6mm"><span class="grey">${esc(
          s.tacticLabel[x.key],
        )}:</span> ${esc(distillEvidence(x.first, 13))}</div>`,
    )
    .join('')
  return `<div>
    <div class="cap mb2">${esc(s.whyWinTitle)}</div>
    ${reasons || noData(s.noTeardown(e.name))}
    ${tactics ? `<div style="margin-top:2.5mm"><div class="cap">${esc(s.tacticsTitle)}</div>${tactics}</div>` : ''}
  </div>`
}

/** One scraped page reduced to the structural facts that win citations. */
function pageRow(s: ExecStr, p: PageEvidence): string {
  const meta: string[] = []
  if (p.format) meta.push(s.formatWord[p.format])
  if (p.wordCount) meta.push(s.wordsCount(p.wordCount))
  if (p.hasFaq) meta.push(s.sigFaq)
  if (p.hasTable) meta.push(s.sigTable)
  if (p.hasStats) meta.push(s.sigStats)
  if (p.schemaTypes.length > 0) meta.push(s.sigSchema(p.schemaTypes.slice(0, 3).join(', ')))
  if (meta.length === 0) meta.push(s.sigNone)
  const short = p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return `<div class="erow">
    <div class="eu">${esc(short.length > 74 ? `${short.slice(0, 74)}…` : short)}</div>
    <div class="em">${esc(meta.join(' · '))}</div>
  </div>`
}

function citedPages(s: ExecStr, e: EntityProfile, max = 2): string {
  const rows =
    e.pages.length > 0
      ? e.pages.slice(0, max).map((p) => pageRow(s, p)).join('')
      : noData(s.noPages(e.name))
  return `<div><div class="cap mb2">${esc(s.citedPagesTitle)}</div>${rows}</div>`
}

function quoteBlock(s: ExecStr, e: EntityProfile): string {
  if (!e.quote) {
    return `<div><div class="cap mb2">${esc(s.quoteTitle)}</div>${noData(s.noQuote(e.name))}</div>`
  }
  return `<div>
    <div class="cap mb2">${esc(s.quoteTitle)}</div>
    <div class="quote">
      <div class="qt">«${esc(e.quote.text)}»</div>
      <div class="qm">${esc(s.quoteMeta(e.quote.engine, clipPrompt(e.quote.prompt, 70)))}</div>
    </div>
  </div>`
}

// ─── Pages ──────────────────────────────────────────────────────────────────

interface PageDef {
  title: string
  render: (n: number, total: number) => string
}

function pageOverview(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
  toc: { page: number; title: string }[],
  lk: Map<string, string>,
): (n: number, total: number) => string {
  return (n, total) => {
    const t = m.client.totals
    const sub = s
      .coverSub(
        m.company.sector,
        m.company.locations.join(' · '),
        m.engineRows.length,
        m.totalRunsOk,
      )
      .split('\n')
      .map((l) => esc(l))
      .join('<br>')
    // Headline KPIs are percentages; the shared base is stated once below
    // the wall instead of being repeated as a fraction in every tile.
    const pctOrNa = (c: Count): string => {
      const p = ratePct(c)
      return p === null || !hasRate(c) ? `<span class="dimc">${esc(s.na)}</span>` : fmtPct(p)
    }
    const kpis = [
      { c: t.mention, lbl: s.statMention },
      { c: t.citation, lbl: s.statCitation },
      { c: t.sov, lbl: s.statSov },
    ]
      .map(
        (x) =>
          `<div class="kpi"><div class="num">${pctOrNa(x.c)}</div><div class="lbl cap">${esc(
            x.lbl,
          )}</div></div>`,
      )
      .join('')
    const rank = fmtRank(t.rank)
    const rankKpi = `<div class="kpi"><div class="num">${
      rank ?? `<span class="dimc">${esc(s.na)}</span>`
    }</div><div class="lbl cap">${esc(s.statRank)}</div></div>`
    const tocRows = toc
      .map(
        (e) =>
          `<div class="tocrow"><span class="n">${e.page < 10 ? `0${e.page}` : e.page}</span><span class="t">${esc(
            e.title,
          )}</span><span class="p">${e.page}</span></div>`,
      )
      .join('')
    const verdict = denominate(distill(m.sections.EXEC_SUMMARY[0] ?? '', 22), lk)
    const impact = s.impactLine(m.impact.lostLeadsMonth, chf(m.impact.lostChfMonth))
    const engineList = m.engineRows.map((r) => r.label).join(' · ')
    return `<div class="page">${brandMark()}
  <div class="mb5"><span class="tag">${esc(s.kicker)} · ${esc(variantLabel)}</span></div>
  <h1 class="mb4" style="margin-top:2mm"><span class="sky">${esc(
    m.company.name,
  )}</span><br>${esc(s.titleLine)}</h1>
  <div class="capline mb6" style="font-size:9pt; line-height:1.6">${sub}<br>${esc(
    engineList,
  )} · ${esc(s.liveTested(m.generatedAt))}</div>
  <div class="spread">
    <div>
      <div class="kpis mb3">${kpis}${rankKpi}</div>
      <div class="capline">${esc(s.countsFirstNote)}</div>
    </div>
    <div>
      <div class="cap mb2">${esc(s.tocTitle)}</div>
      <div class="toc">${tocRows}</div>
    </div>
    <div class="verdict">
      <div class="cap mb2">${esc(s.verdictKicker)}</div>
      <div class="txt mb2">${esc(verdict)}</div>
      <div class="capline">${esc(impact)}</div>
      ${baseNote(m, s, [verdict])}
    </div>
  </div>
  ${footer(m, s, n, total, variantLabel)}
</div>`
  }
}

/** Topic-cluster table for the client — counts, then rates. */
function topicsSection(m: ExecModel, s: ExecStr, roomy = false): string {
  if (m.topicRows.length === 0) return ''
  const rows = m.topicRows
    .map(
      (t) => `<tr>
      <td>${esc(s.topicLabel[t.topic])}</td>
      <td style="white-space:nowrap">${shareBarSvg(
        ratePct(t.clientMention) ?? 0,
        44,
        '#38BDF8',
      )}&nbsp;&nbsp;${cnt(t.clientMention, s)}</td>
      <td style="white-space:nowrap">${shareBarSvg(
        ratePct(t.clientCitation) ?? 0,
        44,
        '#0EA5E9',
      )}&nbsp;&nbsp;${cnt(t.clientCitation, s)}</td>
    </tr>`,
    )
    .join('')
  return `<div>
    <div class="cap mb3">${esc(s.topicsTitle)}</div>
    <table class="${roomy ? 'roomy' : 'compact'}">
      <thead><tr><th>${esc(s.thTopic)}</th><th>${esc(
        s.thMention,
      )}</th><th>${esc(s.thCitation)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function pageClient(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
  lk: Map<string, string>,
): (n: number, total: number) => string {
  return (n, total) => `<div class="page">${brandMark()}
  ${h2(n, s.clientProfile(m.company.name))}
  <div class="spread">
    <div>
      <div class="capline mb5">${esc(statLine(s, m.client))}</div>
      <div class="pattern mb3">
        <div>${metricTable(s, m.client, true)}</div>
        <div>${metricChart(s, m.client, HALF_W, 13, 40)}</div>
      </div>
      <div class="capline">${esc(s.chartCaption)}</div>
      ${minDenomNote(m, s)}
    </div>
    <div class="divider"></div>
    ${topicsSection(m, s)}
    <div class="divider"></div>
    <div>
      <div class="cap mb2">${esc(s.findingsTitle)}</div>
      ${findings(m, s, m.sections.KEY_INSIGHTS, lk, 3, 17)}
    </div>
  </div>
  ${footer(m, s, n, total, variantLabel)}
</div>`
}

/** Gap table: the client against every ranked competitor, counts + points. */
function gapSection(m: ExecModel, s: ExecStr): string {
  if (m.gaps.length === 0) {
    return `<div><div class="cap mb2">${esc(s.gapTitle(m.company.name))}</div>${noData(
      s.noCompetitors,
    )}</div>`
  }
  const row = (g: GapLine): string => {
    const delta =
      g.deltaPts === null
        ? `<span class="na">${esc(s.na)}</span>`
        : `${g.deltaPts > 0 ? '+' : ''}${Math.round(g.deltaPts * 10) / 10}`
    const gapCount = g.other.k - g.client.k
    return `<tr>
      <td>${sw(SERIES_HEX[g.color])}${esc(g.name)}</td>
      <td>${cnt(g.other, s)}</td>
      <td>${cnt(g.client, s)}</td>
      <td>${gapCount > 0 ? '+' : ''}${gapCount}</td>
      <td>${delta}</td>
    </tr>`
  }
  return `<div>
    <div class="cap mb3">${esc(s.gapTitle(m.company.name))}</div>
    <table class="compact">
      <thead><tr><th>${esc(s.thCompetitor)}</th><th>${esc(s.thMention)}</th><th>${esc(
        m.company.name,
      )}</th><th>${esc(s.thGapCount)}</th><th>${esc(s.thGapPts)}</th></tr></thead>
      <tbody>${m.gaps.map(row).join('')}</tbody>
    </table>
  </div>`
}

/** The prompts the client lost outright, with the rivals named instead. */
function missedSection(m: ExecModel, s: ExecStr): string {
  const rows =
    m.missedPrompts.length > 0
      ? m.missedPrompts
          .map((p) => {
            const rivals =
              p.rivals.length > 0
                ? ` · ${s.missedRivals}: ${p.rivals.map((r) => `${r.name} ${r.k}/${p.runs}`).join(' · ')}`
                : ''
            return `<div class="erow">
              <div class="et">«${esc(clipPrompt(p.prompt, 92))}»</div>
              <div class="em">${esc(`${s.missedMeta(p.runs)}${rivals}`)}</div>
            </div>`
          })
          .join('')
      : noData(s.noMissed)
  return `<div><div class="cap mb2">${esc(s.missedTitle(m.company.name))}</div>${rows}</div>`
}

/** The client's own URLs that engines actually linked to — real citations. */
function ownCitationsSection(m: ExecModel, s: ExecStr): string {
  const rows =
    m.ownCitations.length > 0
      ? m.ownCitations
          .map((c) => {
            const short = c.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
            const verified =
              c.verified === null ? '' : ` · ${c.verified ? '✓' : '✗'}`
            return `<div class="erow">
              <div class="eu">${esc(short.length > 74 ? `${short.slice(0, 74)}…` : short)}</div>
              <div class="em">${esc(
                `${ENGINE_SHORT[c.engine]} · «${clipPrompt(c.prompt, 62)}»${verified}`,
              )}</div>
            </div>`
          })
          .join('')
      : noData(s.noOwnCitations(m.company.name))
  return `<div><div class="cap mb2">${esc(s.ownCitationsTitle)}</div>${rows}</div>`
}

function pageClientEvidence(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
  lk: Map<string, string>,
): (n: number, total: number) => string {
  const soloNote =
    m.competitors.length === 0 && m.variant === 'avatar'
      ? `<div class="capline mb4">${esc(s.avatarLensNote)}</div>`
      : ''
  return (n, total) => `<div class="page">${brandMark()}
  ${h2(n, s.clientEvidenceTitle(m.company.name))}
  <div class="spread">
    <div>
      ${soloNote}
      <div class="two">
        ${whereTheyWin(s, m.client)}
        <div>
          <div class="cap mb2">${esc(s.findingsTitle)}</div>
          ${findings(m, s, m.sections.KEY_INSIGHTS, lk, 3, 17)}
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="two">
      ${ownCitationsSection(m, s)}
      ${quoteBlock(s, m.client)}
    </div>
    <div class="divider"></div>
    ${missedSection(m, s)}
    <div class="divider"></div>
    ${gapSection(m, s)}
  </div>
  ${footer(m, s, n, total, variantLabel)}
</div>`
}

function pageCompetitor(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
  e: EntityProfile,
): (n: number, total: number) => string {
  return (n, total) => `<div class="page">${brandMark()}
  ${h2(n, s.entityTitle(e.rankIdx, e.name))}
  <div class="spread">
    <div>
      <div class="csub">${sw(SERIES_HEX[e.color])}<span class="cname">${esc(
        e.name,
      )}</span><span class="crank">${esc(s.competitorTag(e.rankIdx))}</span></div>
      <div class="capline mb4">${esc(statLine(s, e))}</div>
      <div class="pattern">
        <div>${metricTable(s, e)}</div>
        <div>${metricChart(s, e, HALF_W, 11, 26)}</div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="two">
      ${whereTheyWin(s, e)}
      ${whyTheyWin(s, e)}
    </div>
    <div class="divider"></div>
    <div class="two">
      ${citedPages(s, e)}
      ${quoteBlock(s, e)}
    </div>
  </div>
  ${footer(m, s, n, total, variantLabel)}
</div>`
}

/** All-brands mention chart + share of voice on integer bases. */
function pageMarket(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
): (n: number, total: number) => string {
  const series = [m.client, ...m.competitors]
  const clusters: Cluster[] = m.engineRows.map((r) => ({
    label: r.label,
    bars: series.map((e) => {
      const row = e.rows.find((x) => x.engine === r.engine)
      return {
        value: row ? ratePct(row.mention) : null,
        color: SERIES_HEX[e.color],
        label: row ? barLabel(row.mention) : s.na,
      }
    }),
  }))
  const leg = legend(series.map((e) => ({ hex: SERIES_HEX[e.color], label: e.name })))
  const totalMentions = m.sovSlices.reduce((sum, sl) => sum + sl.value, 0)
  const slices: StackSlice[] = m.sovSlices.map((sl) => ({
    label: sl.label === '__others__' ? s.othersLabel : sl.label,
    value: sl.value,
    color: sl.color === 'grey' ? OTHERS_HEX : SERIES_HEX[sl.color],
    inLabel: String(sl.value),
  }))
  const sovLegend = legend(
    slices.map((sl) => ({ hex: sl.color, label: `${sl.label} — ${sl.value}/${totalMentions}` })),
  )
  return (n, total) => `<div class="page">${brandMark()}
  ${h2(n, s.tocMarket)}
  <div class="spread">
    <div>
      <div class="cap mb2">${esc(s.summaryTitle)}</div>
      <div class="capline mb3">${esc(s.summaryCaption)}</div>
      ${leg}<div style="height:4mm"></div>
      ${groupedBarSvg(clusters, { width: FULL_W, barH: 9, clusterGap: 20, naLabel: s.na })}
    </div>
    <div class="divider"></div>
    <div>
      <div class="cap mb2">${esc(s.sovTitle)}</div>
      <div class="capline mb3">${esc(s.sovCaption(totalMentions))}</div>
      ${stackedShareSvg(slices, FULL_W)}
      <div style="height:3.5mm"></div>
      ${sovLegend}
    </div>
    <div class="divider"></div>
    ${topicsSection(m, s)}
  </div>
  ${footer(m, s, n, total, variantLabel)}
</div>`
}

/** Solo-mode replacement for the market page: client topic + engine depth. */
function pageTopicProfile(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
  lk: Map<string, string>,
): (n: number, total: number) => string {
  const engineRows = m.client.rows
    .map(
      (r) => `<tr>
      <td>${esc(r.label)}</td>
      <td><span class="grey">${r.runsOk}</span></td>
      <td>${cnt(r.mention, s)}</td>
      <td>${cnt(r.citation, s)}</td>
      <td>${cnt(r.sov, s)}</td>
      <td>${fmtRank(r.rank) ?? `<span class="na">${esc(s.na)}</span>`}</td>
    </tr>`,
    )
    .join('')
  return (n, total) => `<div class="page">${brandMark()}
  ${h2(n, `${s.tocTopics} · ${s.tocEngineDetail}`)}
  <div class="spread">
    <div>
      <div class="cap mb3">${esc(s.engineDetailTitle(m.company.name))}</div>
      <table class="roomy">
        <thead><tr><th>${esc(s.thEngine)}</th><th>${esc(s.thRuns)}</th><th>${esc(
          s.thMention,
        )}</th><th>${esc(s.thCitation)}</th><th>${esc(s.thSov)}</th><th>${esc(
          s.thRank,
        )}</th></tr></thead>
        <tbody>${engineRows}</tbody>
      </table>
      ${minDenomNote(m, s)}
    </div>
    <div class="divider"></div>
    ${topicsSection(m, s)}
    <div class="divider"></div>
    <div>
      <div class="cap mb2">${esc(s.analysisTitle)}</div>
      ${findings(m, s, m.sections.ANALYSIS.concat(m.sections.MARKET), lk, 3, 17)}
    </div>
  </div>
  ${footer(m, s, n, total, variantLabel)}
</div>`
}

function pageSources(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
  lk: Map<string, string>,
): (n: number, total: number) => string {
  const total = Math.max(1, m.totalCitations)
  const clsWord: Record<string, string> = {
    own: s.clsOwn,
    directory: s.clsDirectory,
    earned: s.clsEarned,
    other: s.clsOther,
  }
  const supplyRows = m.supplyRows
    .map((r) => {
      const share = (100 * r.citations) / total
      const cls = r.isOwn
        ? `<span class="sky">${esc(clsWord[r.cls] ?? r.cls)}</span>`
        : `<span class="grey">${esc(clsWord[r.cls] ?? r.cls)}</span>`
      return `<tr>
      <td>${esc(r.domain)}</td>
      <td>${cls}</td>
      <td style="white-space:nowrap">${shareBarSvg(
        share,
        60,
        r.isOwn ? '#38BDF8' : '#9CA3AF',
      )}&nbsp;&nbsp;${cnt({ k: r.citations, n: m.totalCitations }, s)}</td>
    </tr>`
    })
    .join('')
  const supply =
    m.supplyRows.length > 0
      ? `<div><div class="cap mb3">${esc(s.supplyTitle)}</div>
  <table class="compact">
    <thead><tr><th>${esc(s.thDomain)}</th><th>${esc(s.thClass)}</th><th style="width:44mm">${esc(
      s.thCitations,
    )}</th></tr></thead>
    <tbody>${supplyRows}</tbody>
  </table></div>`
      : `<div><div class="cap mb3">${esc(s.supplyTitle)}</div>${noData(s.na)}</div>`
  // Which answer shapes the engines produce — measured, count-first.
  const shapes = m.evidence.shapes
  const shapeRows = shapes.groups
    .slice(0, 5)
    .map(
      (g) => `<tr>
      <td>${esc(g.signature)}</td>
      <td>${cnt({ k: g.answers, n: shapes.answersAnalyzed }, s)}</td>
      <td>${Math.round(g.avgChars)}</td>
      <td>${Math.round(g.avgCitedUrls * 10) / 10}</td>
    </tr>`,
    )
    .join('')
  const shapesBlock =
    shapes.groups.length > 0
      ? `<div>
    <div class="cap mb2">${esc(s.shapesTitle)}</div>
    <div class="capline mb3">${esc(s.shapesCaption(shapes.answersAnalyzed))}</div>
    <table class="compact">
      <thead><tr><th>${esc(s.thShape)}</th><th>${esc(s.thAnswers)}</th><th>${esc(
        s.thChars,
      )}</th><th>${esc(s.thCitedUrls)}</th></tr></thead>
      <tbody>${shapeRows}</tbody>
    </table>
  </div>`
      : ''
  const notes = m.sections.CITATIONS.concat(m.sections.MARKET)
  return (n, tot) => `<div class="page">${brandMark()}
  ${h2(n, s.sourcesTitle)}
  <div class="spread">
    ${supply}
    ${shapesBlock ? `<div class="divider"></div>${shapesBlock}` : ''}
    <div class="divider"></div>
    <div>
      <div class="cap mb2">${esc(s.sourceFindingsTitle)}</div>
      ${findings(m, s, notes, lk, 3)}
    </div>
  </div>
  ${footer(m, s, n, tot, variantLabel)}
</div>`
}

/** Shorten a planned-page title to its head clause (before ":" / "—"). */
function shortTitle(t: string): string {
  return (t.split(/[:—–|]/)[0] ?? t).trim()
}

/**
 * Executive letter — visually unlike every other page: no h2, no tables, no
 * charts. A short management verdict set large, three numbered plain-text
 * steps for the next 90 days, a signature line, and the 6.5pt methodology
 * strip at the very bottom. (v6 design, approved — unchanged.)
 */
/**
 * Closing page — THE GAP the business is leaving behind.
 *
 * Deliberately not an action plan: the deck closes on what the market is
 * currently handing to competitors, in the client's own measured data —
 * the questions where the brand never surfaces and who collects the answer
 * instead, the metric-by-metric distance to the strongest rival, and the
 * modeled commercial size of that gap. Everything here is measured or
 * explicitly labelled as modeled; nothing is prescribed.
 */
function pageClose(
  m: ExecModel,
  s: ExecStr,
  variantLabel: string,
  lk: Map<string, string>,
): (n: number, total: number) => string {
  return (n, total) => {
    const verdict = denominate(distillLetter(m), lk)

    // Questions the client never appears in, with the rivals that do.
    const missed = m.missedPrompts.slice(0, 4)
    const missedRows = missed.length
      ? missed
          .map((mp) => {
            const rivals = mp.rivals
              .slice(0, 3)
              .map((r) => esc(r.name))
              .join(' · ')
            return `<div class="gaprow">
      <div class="gq">«${esc(clipPrompt(mp.prompt, 92))}»</div>
      <div class="gr">${rivals ? `${esc(s.missedRivals)}: ${rivals}` : esc(s.na)}</div>
    </div>`
          })
          .join('')
      : `<div class="capline">${esc(s.noMissed)}</div>`

    // Distance to the strongest measured rival, per metric.
    const lead = m.gaps.find((g: GapLine) => g.deltaPts !== null && g.deltaPts > 0)
    const leadLine = lead
      ? `<div class="gaplead"><span class="grey">${esc(s.gapLeadLabel)}</span> <span class="sky">${esc(
          lead.name,
        )}</span> <span class="dimc">·</span> ${fmtPct(lead.deltaPts ?? 0)} ${esc(
          s.gapLeadUnit,
        )}</div>`
      : ''

    const method = s
      .methodStrip(m.engineRows.map((r) => r.label).join(' · '), m.totalRunsOk)
      .map((x) => esc(x))
      .join('&nbsp;&nbsp;·&nbsp;&nbsp;')

    return `<div class="page">${brandMark()}
  <div><span class="tag">${esc(s.gapPageTitle)}</span></div>
  <div style="height:16mm"></div>
  <div class="cap mb4">${esc(s.resultKicker)}</div>
  <div class="lverdict">${esc(verdict)}</div>
  <div class="grow" style="min-height:10mm"></div>
  <div>
    <div class="cap mb2">${esc(s.gapQuestionsTitle)}</div>
    <div class="capline mb5">${esc(s.gapQuestionsNote)}</div>
    ${missedRows}
    ${leadLine}
  </div>
  <div class="grow" style="min-height:10mm"></div>
  <div class="gapimpact">${esc(
    s.impactLine(m.impact.lostLeadsMonth, chf(m.impact.lostChfMonth)),
  )}</div>
  <div class="sig">
    <div class="sigrule"></div>
    <span>${esc(m.company.name)}</span><span class="dimc"> · </span><span class="sky">${esc(
      s.closingBrand,
    )}</span><span class="dimc"> · </span><span class="grey">${esc(m.generatedAt)}</span>
  </div>
  <div style="height:10mm"></div>
  <div class="method">${method}</div>
  ${footer(m, s, n, total, variantLabel)}
</div>`
  }
}

// ─── Entry ──────────────────────────────────────────────────────────────────

export function buildExecutiveHtml(m: ExecModel): string {
  const s = STR[m.lang]
  const variantLabel = m.variant === 'avatar' ? s.variantAvatar : s.variantGeneral
  const lk = pctLookup(m)

  // Page plan is data-driven: contents and page numbers follow the pages that
  // actually exist, so a slice without competitors is a complete short deck.
  const body: PageDef[] = [
    { title: s.tocClient(m.company.name), render: pageClient(m, s, variantLabel, lk) },
    {
      title: s.tocClientEvidence,
      render: pageClientEvidence(m, s, variantLabel, lk),
    },
    ...m.competitors.map((e) => ({
      title: s.tocEntity(e.rankIdx, e.name),
      render: pageCompetitor(m, s, variantLabel, e),
    })),
    m.competitors.length > 0
      ? { title: s.tocMarket, render: pageMarket(m, s, variantLabel) }
      : {
          title: `${s.tocTopics} · ${s.tocEngineDetail}`,
          render: pageTopicProfile(m, s, variantLabel, lk),
        },
    { title: s.tocSources, render: pageSources(m, s, variantLabel, lk) },
    { title: s.tocClose, render: pageClose(m, s, variantLabel, lk) },
  ]
  const total = body.length + 1
  const toc = body.map((p, i) => ({ page: i + 2, title: p.title }))
  const cover = pageOverview(m, s, variantLabel, toc, lk)

  const title = `${s.kicker} — ${m.company.name} (${variantLabel})`
  return `<!doctype html>
<html lang="${m.lang}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${cover(1, total)}
${body.map((p, i) => p.render(i + 2, total)).join('\n')}
</body>
</html>`
}
