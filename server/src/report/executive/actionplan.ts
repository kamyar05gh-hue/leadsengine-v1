/**
 * actionplan.ts — GEO Action Plan PDF ("mission briefing" family member).
 *
 * Same Chromium render path and black/panel base as the audit deck, but
 * lavender-led (#C4B5FD primary, sky #38BDF8 secondary): a forward-looking
 * roadmap document, not an analysis dossier. 4 A4 pages:
 *   P1 cover      — kicker, company, mission statement, 3 KPI tiles,
 *                   vertical phase timeline (Woche 1–2 / 3–4 / laufend)
 *   P2 roadmap    — ActionPlan.pages as priority-sorted premium cards
 *   P3 setup      — schema / directories / entity tasks (labeled "n/a —
 *                   none planned" tiles when empty) + competitor context
 *   P4 measurement— weekly-KPI chips, GA4 segments, distilled tracking
 *                   setup, closing banner
 * Rendered in BOTH languages: LeadEngine_ActionPlan_<Name>_{DE,EN}.pdf.
 */
import path from 'node:path'
import type { Browser } from 'playwright'

import type {
  ActionPlanInput,
  Company,
  PageSpec,
  ReportLang,
  ReverseReport,
} from '../../types.js'
import { htmlToPdf, withBrowser } from './render.js'
import { AP_STR, type ApStr } from './strings.js'

const PAGES = 4
const ACC = '#C4B5FD' // lavender — primary accent of this family
const ACC2 = '#A78BFA'
const SKY = '#38BDF8' // secondary

// ─── Helpers (self-contained; the audit deck keeps its own copies) ──────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stripNoise(s: string): string {
  return s.replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim()
}

/** Hard word cap — every copy line in this document stays ≤10 words. */
function capWords(raw: string, maxWords = 10): string {
  const words = stripNoise(raw).split(/\s+/)
  const t = words.length > maxWords ? words.slice(0, maxWords).join(' ') + ' …' : words.join(' ')
  return t.replace(/[.,;:]\s*$/, '')
}

function slug(name: string): string {
  return name.replace(/\s+/g, '_')
}

/** Priority tier (1..3) from the page's rank among the distinct priorities. */
function tierOf(p: PageSpec, distinct: number[]): 1 | 2 | 3 {
  const i = distinct.indexOf(p.priority)
  return i <= 0 ? 1 : i === 1 ? 2 : 3
}

const TIER_HEX: Record<1 | 2 | 3, string> = { 1: ACC, 2: ACC2, 3: '#374151' }

interface Kpi {
  name: string
  benchmark: string | null
}

/** "mention_rate: … benchmark 6.7%" → { name: "mention rate", benchmark: "6.7%" }. */
function parseKpi(raw: string): Kpi {
  const head = (raw.split(':')[0] ?? raw).trim().replace(/_/g, ' ')
  const bm = /benchmark[^\d]*([\d.,]+\s*%)/i.exec(raw)?.[1] ?? null
  return { name: capWords(head, 4), benchmark: bm }
}

/** Numbered instruction wall ("1. " / "1) ") → up to `n` short lines (≤10 words each). */
function snippetLines(raw: string, n = 3): string[] {
  return stripNoise(raw)
    .split(/\s*\d+[.)]\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, n)
    .map((x) => capWords(x, 10))
}

// ─── Stylesheet — lavender-led sibling of the audit deck ────────────────────

const CSS = `
@page { size: A4; margin: 0 }
:root {
  --acc: ${ACC}; --acc2: ${ACC2}; --sky: ${SKY}; --white: #FFFFFF;
  --grey: #9CA3AF; --panel: #101018; --line: #1F1F2B; --rule: #14141C;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: #000000; }
body { font-family: "Segoe UI", Arial, sans-serif; color: var(--white); }
.page {
  width: 210mm; min-height: 297mm; max-height: 297mm;
  padding: 13mm 14mm 16mm; page-break-after: always;
  overflow: hidden; position: relative; background: #000000;
}
.page:last-child { page-break-after: auto; }
h1 { font-size: 26pt; font-weight: 800; line-height: 1.12; }
h2 {
  font-size: 14pt; font-weight: 800; border-left: 2.5px solid var(--acc);
  padding-left: 4mm; margin-bottom: 6mm; letter-spacing: .2px;
}
h3 { font-size: 9pt; font-weight: 800; margin-bottom: 2.6mm; text-transform: uppercase; letter-spacing: 1px; }
.acc { color: var(--acc); } .sky { color: var(--sky); }
.grey { color: var(--grey); } .dim { color: #4B5563; }
.kicker {
  display: inline-block; text-transform: uppercase; letter-spacing: 2.5px;
  font-size: 7.5pt; font-weight: 700; color: var(--acc);
  border: .5pt solid var(--acc); border-radius: 20px; padding: 1.6mm 4.2mm;
}
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5mm; }
.grid2 > *, .grid3 > * { min-width: 0; }
.card { background: var(--panel); border: .5pt solid var(--line); border-radius: 2.5mm; padding: 4mm; }
.stat { padding: 5mm 4mm; }
.stat .num { font-size: 22pt; font-weight: 800; color: var(--acc); line-height: 1.1; }
.stat .lbl { font-size: 6.5pt; color: var(--grey); text-transform: uppercase; letter-spacing: 1px; margin-top: 1.2mm; }
.caption { font-size: 7.5pt; color: var(--grey); }
.mb2 { margin-bottom: 2mm; } .mb3 { margin-bottom: 3mm; } .mb4 { margin-bottom: 4mm; }
.mb5 { margin-bottom: 5mm; } .mb6 { margin-bottom: 6mm; } .mb8 { margin-bottom: 8mm; }
.badge {
  display: inline-block; font-size: 6.5pt; font-weight: 700; text-transform: uppercase;
  letter-spacing: .5px; padding: .8mm 2.4mm; border-radius: 2mm;
}
.b-acc { background: rgba(196,181,253,.14); color: var(--acc); }
.b-sky { background: rgba(56,189,248,.14); color: var(--sky); }
.b-grey { background: rgba(156,163,175,.12); color: var(--grey); }
.chip {
  display: inline-flex; align-items: center; font-size: 7.5pt; font-weight: 700;
  border: .5pt solid var(--line); border-radius: 20px; padding: 1.2mm 3.2mm;
  margin: 0 2mm 2mm 0; background: var(--panel);
}
.chip .k { color: var(--grey); font-weight: 600; margin-right: 1.4mm; text-transform: uppercase; font-size: 6.5pt; letter-spacing: .6px; }
.footer {
  position: absolute; left: 14mm; right: 14mm; bottom: 7mm;
  display: flex; justify-content: space-between; font-size: 7.5pt; color: var(--grey);
  border-top: .5pt solid var(--line); padding-top: 2.2mm;
}
table { width: 100%; border-collapse: collapse; font-size: 8pt; }
th {
  color: var(--grey); text-transform: uppercase; letter-spacing: 1px; font-size: 6.5pt;
  text-align: left; padding: 1.8mm 2mm; border-bottom: .5pt solid var(--line);
}
td { padding: 1.7mm 2mm; border-bottom: .5pt solid var(--rule); vertical-align: middle; }
/* mission statement */
.mission { border-left: 2.5px solid var(--acc); background: var(--panel); padding: 5mm 6mm; border-radius: 0 2.5mm 2.5mm 0; }
/* vertical phase timeline — the wrapper flexes to fill the cover */
.phases { flex: 1; max-height: 135mm; display: flex; flex-direction: column; margin: 2mm 0 12mm; }
.phase { display: flex; gap: 4.5mm; position: relative; flex: 1; padding-bottom: 6mm; }
.phase:last-child { flex: 0; padding-bottom: 0; }
.phase .rail { display: flex; flex-direction: column; align-items: center; width: 5mm; }
.phase .node {
  width: 3.6mm; height: 3.6mm; border-radius: 50%; background: var(--acc);
  box-shadow: 0 0 0 1.2mm rgba(196,181,253,.18); margin-top: 1mm; flex: none;
}
.phase .cord { width: .5mm; flex: 1; background: var(--line); margin-top: 1.6mm; }
.phase:last-child .cord { display: none; }
.phase .tag {
  font-size: 6.5pt; font-weight: 700; color: var(--acc); text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: .8mm;
}
.phase .t { font-size: 11pt; font-weight: 800; margin-bottom: .8mm; }
.phase .d { font-size: 8pt; color: var(--grey); }
/* page-spec cards */
.pcard { background: var(--panel); border: .5pt solid var(--line); border-radius: 2.5mm; padding: 4.2mm 4.4mm; }
.pcard .prio {
  display: inline-block; min-width: 9mm; text-align: center; font-size: 7.5pt;
  font-weight: 800; padding: 1mm 1.8mm; border-radius: 2mm; color: #000;
}
.pcard .t {
  font-size: 8.5pt; font-weight: 700; line-height: 1.3; margin: 2.2mm 0 1.6mm;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pcard .q {
  font-size: 6.5pt; color: var(--grey); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; margin-bottom: 1.8mm;
}
.pcard .slug {
  font-family: Consolas, "Courier New", monospace; font-size: 6.5pt; color: var(--acc2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;
}
/* n/a tile for empty sections */
.natile {
  border: .5pt dashed var(--line); border-radius: 2.5mm; padding: 12mm 4mm;
  text-align: center; color: var(--grey); font-size: 7.5pt;
}
/* competitor context rows (P3) */
.crow { padding: 3.4mm 1mm; border-bottom: .5pt solid var(--rule); }
.crow:last-child { border-bottom: none; }
.crow .who { font-size: 9pt; font-weight: 800; color: var(--acc); margin-bottom: 1mm; }
.crow .why { font-size: 8pt; color: var(--grey); line-height: 1.45; }
/* measurement rows + closing banner */
.mrow { display: flex; align-items: flex-start; gap: 3mm; padding: 3.2mm 1mm; border-bottom: .5pt solid var(--rule); font-size: 8.5pt; line-height: 1.4; }
.mrow:last-child { border-bottom: none; }
.mrow .n { color: var(--acc); font-weight: 800; }
.banner {
  border: .5pt solid var(--acc); border-radius: 2.5mm; background: rgba(196,181,253,.07);
  padding: 5mm 6mm; display: flex; align-items: center; justify-content: space-between; gap: 5mm;
}
.banner .t { font-size: 11pt; font-weight: 700; line-height: 1.4; }
`

// ─── Pages ──────────────────────────────────────────────────────────────────

function footer(company: Company, s: ApStr, n: number): string {
  return `<div class="footer"><span>${esc(s.footerLeft(company.name))}</span><span>${esc(
    s.pageOf(n, PAGES),
  )}</span></div>`
}

function h2(num: string, t: string): string {
  return `<h2><span class="acc">${num}</span> · ${esc(t)}</h2>`
}

function naTile(s: ApStr): string {
  return `<div class="natile">${esc(s.naNone)}</div>`
}

function pageCover(company: Company, plan: ActionPlanInput, s: ApStr, date: string): string {
  const pages = plan.pages
  const distinct = [...new Set(pages.map((p) => p.priority))].sort((a, b) => a - b)
  const prio1 = pages.filter((p) => tierOf(p, distinct) === 1).length
  const kpis = [
    { num: String(pages.length), lbl: s.kpiPages },
    { num: String(plan.directoryListings.length), lbl: s.kpiDirs },
    { num: String(prio1), lbl: s.kpiPrio },
  ]
    .map((t) => `<div class="card stat"><div class="num">${t.num}</div><div class="lbl">${esc(t.lbl)}</div></div>`)
    .join('')
  const phases = s.phases
    .map(
      (p) => `<div class="phase">
      <div class="rail"><div class="node"></div><div class="cord"></div></div>
      <div><div class="tag">${esc(p.tag)}</div><div class="t">${esc(p.title)}</div><div class="d">${esc(p.desc)}</div></div>
    </div>`,
    )
    .join('')
  return `<div class="page" style="display:flex; flex-direction:column">
  <div class="mb5"><span class="kicker">${esc(s.kicker)} · ${esc(date)}</span></div>
  <h1 class="mb2" style="margin-top:2mm"><span class="acc">${esc(company.name)}</span></h1>
  <div class="caption mb8" style="font-size:10pt">${esc(company.sector)} · ${esc(company.locations.join(' · '))}</div>
  <div class="mission mb8">
    <div class="caption mb2" style="text-transform:uppercase; letter-spacing:1.5px">${esc(s.missionKicker)}</div>
    <div style="font-size:13pt; font-weight:600; line-height:1.45">${esc(s.mission(pages.length, company.name))}</div>
  </div>
  <div class="grid3 mb8">${kpis}</div>
  <h3 class="acc">${esc(s.phasesTitle)}</h3>
  <div class="phases">${phases}</div>
  ${footer(company, s, 1)}
</div>`
}

function pageRoadmap(company: Company, plan: ActionPlanInput, s: ApStr): string {
  const sorted = [...plan.pages].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))
  const distinct = [...new Set(sorted.map((p) => p.priority))].sort((a, b) => a - b)
  const shown = sorted.slice(0, 12)
  const cards = shown
    .map((p) => {
      const tier = tierOf(p, distinct)
      const hex = TIER_HEX[tier]
      return `<div class="pcard" style="border-top:2px solid ${hex}">
      <span class="prio" style="background:${hex}${tier === 3 ? ';color:#FFF' : ''}">P${p.priority}</span>
      <span class="badge b-sky" style="margin-left:1.5mm">${esc(p.schemaType)}</span>
      <div class="t">${esc(p.title)}</div>
      <div class="q"><span style="letter-spacing:.5px; text-transform:uppercase">${esc(s.targetQuery)}</span> — ${esc(p.targetQuery)}</div>
      <span class="slug">/${esc(p.slug)}</span>
    </div>`
    })
    .join('')
  const more =
    sorted.length > shown.length
      ? `<div class="natile" style="display:flex; align-items:center; justify-content:center">${esc(
          s.morePages(sorted.length - shown.length),
        )}</div>`
      : ''
  return `<div class="page" style="display:flex; flex-direction:column">
  ${h2('01', s.s1)}
  <div class="grid3" style="gap:5mm; flex:1; align-content:space-evenly; margin-bottom:10mm">${cards}${more}</div>
  ${footer(company, s, 2)}
</div>`
}

function pageSetup(company: Company, plan: ActionPlanInput, reverse: ReverseReport[], s: ApStr): string {
  const schema =
    plan.schemaSnippets.length > 0
      ? plan.schemaSnippets
          .slice(0, 8)
          .map(
            (x) =>
              `<span class="chip"><span class="k">${esc(x.type)}</span>${esc(capWords(x.page, 5))}</span>`,
          )
          .join('')
      : naTile(s)
  const dirs =
    plan.directoryListings.length > 0
      ? `<table>
        <thead><tr><th>${esc(s.thDirectory)}</th><th>${esc(s.thAction)}</th></tr></thead>
        <tbody>${plan.directoryListings
          .slice(0, 8)
          .map(
            (d) =>
              `<tr><td>${esc(d.directory)}</td><td><span class="badge b-acc">${esc(
                s.actionWord[d.action],
              )}</span></td></tr>`,
          )
          .join('')}</tbody>
      </table>`
      : naTile(s)
  const entities =
    plan.entityTasks.length > 0
      ? plan.entityTasks
          .slice(0, 6)
          .map(
            (t) =>
              `<div class="mrow"><span class="n">▸</span><span>${esc(capWords(t.task, 8))} <span class="grey">— ${esc(
                capWords(t.where, 4),
              )}</span></span></div>`,
          )
          .join('')
      : naTile(s)
  const context = reverse
    .slice(0, 5)
    .map((r) => {
      const why = r.whyTheyWin
        .slice(0, 2)
        .map((w) => capWords(w, 10))
        .filter(Boolean)
        .join(' · ')
      return `<div class="crow"><div class="who">${esc(r.competitor)}</div><div class="why">${esc(why)}</div></div>`
    })
    .join('')
  return `<div class="page" style="display:flex; flex-direction:column">
  ${h2('02', s.s2)}
  <div class="grid3 mb8" style="align-items:start">
    <div><h3 class="acc">${esc(s.schemaTitle)}</h3>${schema}</div>
    <div><h3 class="acc">${esc(s.dirTitle)}</h3>${dirs}</div>
    <div><h3 class="acc">${esc(s.entityTitle)}</h3>${entities}</div>
  </div>
  ${
    context
      ? `<h3 class="acc">${esc(s.contextTitle)}</h3>
  <div class="card" style="flex:1; display:flex; flex-direction:column; justify-content:space-evenly; padding:2mm 5.5mm; margin-bottom:10mm">${context}</div>`
      : ''
  }
  ${footer(company, s, 3)}
</div>`
}

function pageMeasure(company: Company, plan: ActionPlanInput, s: ApStr): string {
  const m = plan.measurement
  const kpiChips = m.weeklyKpis
    .slice(0, 10)
    .map(parseKpi)
    .map(
      (k) =>
        `<span class="chip">${esc(k.name)}${
          k.benchmark ? `&nbsp;<span class="acc">${esc(k.benchmark)}</span>` : ''
        }</span>`,
    )
    .join('')
  const ga4 = m.ga4Segments
    .slice(0, 8)
    .map((g) => `<span class="chip"><span class="sky">${esc(capWords(g.replace(/\|/g, ' · '), 4))}</span></span>`)
    .join('')
  const lines = snippetLines(m.snippetInstructions, 3)
    .map((l, i) => `<div class="mrow"><span class="n">${i + 1}</span><span>${esc(l)}</span></div>`)
    .join('')
  return `<div class="page" style="display:flex; flex-direction:column; justify-content:space-between">
  ${h2('03', s.s3)}
  <div><h3 class="acc">${esc(s.kpiTitle)}</h3>
    <div class="card" style="padding:4mm 4.5mm 2mm">${kpiChips}</div>
  </div>
  <div><h3 class="acc">${esc(s.ga4Title)}</h3>
    <div class="card" style="padding:4mm 4.5mm 2mm">${ga4}</div>
  </div>
  <div><h3 class="acc">${esc(s.snippetTitle)}</h3>
    <div class="card" style="padding:2mm 5mm">${lines}</div>
  </div>
  <div style="margin-bottom:10mm">
    <div class="banner">
      <span class="t">${esc(s.closing(company.name))}</span>
      <span class="badge b-acc" style="white-space:nowrap">${esc(s.closingTag)}</span>
    </div>
  </div>
  ${footer(company, s, 4)}
</div>`
}

// ─── Entry ──────────────────────────────────────────────────────────────────

export function buildActionPlanHtml(
  company: Company,
  plan: ActionPlanInput,
  reverse: ReverseReport[],
  lang: ReportLang,
): string {
  const s = AP_STR[lang]
  const date = new Date().toISOString().slice(0, 10)
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${esc(`${s.docTitle} — ${company.name}`)}</title>
<style>${CSS}</style>
</head>
<body>
${pageCover(company, plan, s, date)}
${pageRoadmap(company, plan, s)}
${pageSetup(company, plan, reverse, s)}
${pageMeasure(company, plan, s)}
</body>
</html>`
}

export interface RenderedPlanPdf {
  path: string
  lang: ReportLang
}

/** Render one language of the plan to `outPath` via a shared browser. */
export async function renderActionPlanPdf(
  browser: Browser,
  company: Company,
  plan: ActionPlanInput,
  reverse: ReverseReport[],
  lang: ReportLang,
  outPath: string,
): Promise<void> {
  await htmlToPdf(browser, buildActionPlanHtml(company, plan, reverse, lang), outPath)
}

/** Render DE + EN action-plan PDFs into `dir`; returns the written files. */
export async function renderActionPlanPdfs(
  company: Company,
  plan: ActionPlanInput,
  reverse: ReverseReport[],
  dir: string,
): Promise<RenderedPlanPdf[]> {
  const out: RenderedPlanPdf[] = []
  await withBrowser(async (browser) => {
    for (const lang of ['de', 'en'] as const) {
      const outPath = path.join(
        dir,
        `LeadEngine_ActionPlan_${slug(company.name)}_${lang.toUpperCase()}.pdf`,
      )
      await renderActionPlanPdf(browser, company, plan, reverse, lang, outPath)
      out.push({ path: outPath, lang })
    }
  })
  return out
}
