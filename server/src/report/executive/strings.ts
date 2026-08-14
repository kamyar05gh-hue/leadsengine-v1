/**
 * strings.ts — DE/EN string tables for the Dark Executive Report (v7).
 * Swiss business German (no ß). Every user-visible label lives here.
 * v6 rule kept: plain typographic labels only — zero pills/chips/badges
 * anywhere. Tags render as editorial marginalia (uppercase grey text with a
 * 2px accent rule), and the closing page is an executive letter, not a
 * dashboard page.
 *
 * v7 adds the statistical vocabulary (confidence intervals, count-over-
 * denominator phrasing, the small-sample suppression footnote) and the
 * per-entity deep-dive vocabulary (where/why they win, their cited pages,
 * verbatim evidence, gap-to-field).
 */
import type { CompetitorPage, ReportLang, TopicKey } from '../../types.js'

/** Answer-format words used on the competitor page-evidence rows. */
type FormatKey = NonNullable<CompetitorPage['answerFormat']>

export interface ExecStr {
  // chrome
  kicker: string
  variantGeneral: string
  variantAvatar: string
  liveTested: (date: string) => string
  footerLeft: (client: string, variant: string) => string
  pageOf: (n: number, total: number) => string
  na: string
  // p1 — overview
  titleLine: string
  coverSub: (sector: string, locations: string, engines: number, runs: number) => string
  statMention: string
  statCitation: string
  statSov: string
  statRank: string
  tocTitle: string
  tocClient: (name: string) => string
  tocCompetitors: (a: number, b: number) => string
  tocCompetitorOne: (i: number) => string
  tocMarket: string
  tocEngineDetail: string
  tocTopics: string
  tocSources: string
  tocClose: string
  verdictKicker: string
  // ── v7: statistical presentation ─────────────────────────────────────────
  /** 95% Wilson interval, e.g. "95 % KI 0.6–17 %". */
  ci95: (lo: string, hi: string) => string
  /** How to read every figure in the deck — one line, page 1. */
  countsFirstNote: string
  /** Why some cells show n/a instead of a percentage. */
  minDenomNote: (min: number) => string
  /** "1 von 30 gemessenen Antworten". */
  ofAnswers: (k: number, n: number) => string
  /** "in 3 von 4 Antworten genannt". */
  namedIn: (k: number, n: number) => string
  /** Percentage-only variant: "in 75% der Antworten genannt". */
  namedInPct: (pct: string) => string
  /** "4 von 27 Marken-Nennungen". */
  sovOf: (k: number, n: number) => string
  // ── v7: entity deep-dive ─────────────────────────────────────────────────
  entityTitle: (i: number, name: string) => string
  tocEntity: (i: number, name: string) => string
  tocClientEvidence: string
  clientEvidenceTitle: (name: string) => string
  whereWinTitle: string
  whyWinTitle: string
  tacticsTitle: string
  citedPagesTitle: string
  quoteTitle: string
  gapTitle: (name: string) => string
  thCompetitor: string
  thGap: string
  promptsNamedTitle: (name: string) => string
  topicStrengthTitle: string
  formatWord: Record<FormatKey, string>
  wordsCount: (n: number) => string
  sigFaq: string
  sigTable: string
  sigStats: string
  sigSchema: (types: string) => string
  sigNone: string
  tacticLabel: Record<'content' | 'schema' | 'directories' | 'earned' | 'entity', string>
  noPrompts: (name: string) => string
  noQuote: (name: string) => string
  noTeardown: (name: string) => string
  noPages: (name: string) => string
  noCompetitors: string
  quoteMeta: (engine: string, prompt: string) => string
  /** Base line under any block whose LLM-written prose quotes percentages. */
  sampleBaseNote: (answers: number, citations: number) => string
  thGapPts: string
  thGapCount: string
  ownCitationsTitle: string
  noOwnCitations: (name: string) => string
  missedTitle: (name: string) => string
  missedMeta: (runs: number) => string
  missedRivals: string
  noMissed: string
  shapesTitle: string
  shapesCaption: (n: number) => string
  thShape: string
  thAnswers: string
  thChars: string
  thCitedUrls: string
  // pattern pages (p2–p4)
  clientProfile: (name: string) => string
  competitorsTitle: string
  competitorTag: (i: number) => string
  rankWord: string
  statLine: (m: string, c: string, sov: string, rank: string | null) => string
  thEngine: string
  thMention: string
  thCitation: string
  thSov: string
  thRank: string
  thRuns: string
  /** Sample-size column header (measured answers behind each rate row). */
  thN: string
  /** Small-sample caveat when an engine ran on fewer than 20 answers. */
  lowSample: (minN: number) => string
  totalRow: string
  chartCaption: string
  summaryTitle: string
  summaryCaption: string
  findingsTitle: string
  engineDetailTitle: (name: string) => string
  topicsTitle: string
  thTopic: string
  thPrompts: string
  topicLabel: Record<TopicKey, string>
  analysisTitle: string
  avatarLensNote: string
  // p5 — sources & market
  sourcesTitle: string
  supplyTitle: string
  thDomain: string
  thClass: string
  thCitations: string
  thShare: string
  clsOwn: string
  clsDirectory: string
  clsEarned: string
  clsOther: string
  sovTitle: string
  sovCaption: (total: number) => string
  othersLabel: string
  sourceFindingsTitle: string
  // p6 — executive letter
  closeTitle: string
  resultKicker: string
  impactLine: (leads: number, chf: string) => string
  next90Title: string
  horizon: { p1: string; p2: string; p3: string }
  /** One qualitative expected-effect line per 90-day step (grey, no numbers). */
  stepEffect: { p1: string; p2: string; p3: string }
  newPage: (title: string) => string
  methodStrip: (engines: string, answers: number) => string[]
  /** Closing page — the gap the business leaves behind. */
  gapPageTitle: string
  gapQuestionsTitle: string
  gapQuestionsNote: string
  gapLeadLabel: string
  gapLeadUnit: string
  closingBrand: string
}

const TOPIC_DE: Record<TopicKey, string> = {
  pricing: 'Preise & Kosten',
  comparison: 'Vergleiche',
  local: 'Lokal & regional',
  service: 'Leistungen',
  general: 'Allgemein',
}
const TOPIC_EN: Record<TopicKey, string> = {
  pricing: 'Pricing & cost',
  comparison: 'Comparisons',
  local: 'Local & regional',
  service: 'Services',
  general: 'General',
}

export const STR: Record<ReportLang, ExecStr> = {
  de: {
    kicker: 'AI-Visibility Audit',
    variantGeneral: 'Marktübersicht',
    variantAvatar: 'Avatar-Linse',
    liveTested: (d) => `Live getestet am ${d}`,
    footerLeft: (c, v) => `AI-Visibility Audit — ${c} · ${v}`,
    pageOf: (n, t) => `Seite ${n} von ${t}`,
    na: 'n/a',
    titleLine: 'Sichtbarkeit in KI-Antworten',
    coverSub: (sector, locations, engines, runs) =>
      `${sector} · ${locations}\n${runs} live gemessene KI-Antworten über ${engines} Engines`,
    statMention: 'Erwähnungsrate',
    statCitation: 'Zitationsrate',
    statSov: 'Share of Voice',
    statRank: 'Ø Rang bei Nennung',
    tocTitle: 'Inhalt',
    tocClient: (name) => `Kundenprofil — ${name}`,
    tocCompetitors: (a, b) => `Wettbewerber #${a} und #${b}`,
    tocCompetitorOne: (i) => `Wettbewerber #${i}`,
    tocMarket: 'Marktvergleich — alle Marken',
    tocEngineDetail: 'Detail pro Engine',
    tocTopics: 'Themenprofil',
    tocSources: 'Quellen & Markt',
    tocClose: 'Ergebnis & nächste Schritte',
    verdictKicker: 'Das Urteil',
    ci95: (lo, hi) => `95 % KI ${lo}–${hi}`,
    countsFirstNote:
      'Lesart: Alle Werte sind Prozentanteile der gemessenen KI-Antworten dieses Berichts. Die vollstaendige Stichprobe steht in der Methodik auf der letzten Seite.',
    minDenomNote: (min) =>
      `Basis unter ${min} Antworten: kein Prozentwert ausgewiesen (n/a) — bei so kleiner Basis waere jede Prozentangabe irrefuehrend.`,
    ofAnswers: (k, n) => `${k} von ${n} gemessenen Antworten`,
    namedIn: (k, n) => `in ${k} von ${n} Antworten genannt`,
    namedInPct: (pct) => `in ${pct} der Antworten genannt`,
    sovOf: (k, n) => `${k} von ${n} Marken-Nennungen`,
    entityTitle: (i, name) => `Wettbewerber #${i} — ${name}`,
    tocEntity: (i, name) => `Wettbewerber #${i} — ${name}`,
    tocClientEvidence: 'Belege & Abstand zum Feld',
    clientEvidenceTitle: (name) => `Belege & Abstand zum Feld — ${name}`,
    whereWinTitle: 'Wo sie gewinnen',
    whyWinTitle: 'Warum sie gewinnen',
    tacticsTitle: 'Taktiken',
    citedPagesTitle: 'Ihre erfassten Seiten',
    quoteTitle: 'Textbeleg',
    gapTitle: (name) => `Abstand — ${name} gegen das Feld`,
    thCompetitor: 'Wettbewerber',
    thGap: 'Abstand',
    promptsNamedTitle: (name) => `Prompts, in denen ${name} genannt wird`,
    topicStrengthTitle: 'Stärkste Themencluster',
    formatWord: {
      faq: 'FAQ-Format',
      table: 'Tabellen-Format',
      list: 'Listen-Format',
      prose: 'Fliesstext',
    },
    wordsCount: (n) => `${n} Wörter`,
    sigFaq: 'FAQ-Block',
    sigTable: 'Vergleichstabelle',
    sigStats: 'Zahlen & Statistiken',
    sigSchema: (types) => `Schema: ${types}`,
    sigNone: 'keine strukturellen Signale erfasst',
    tacticLabel: {
      content: 'Content',
      schema: 'Schema',
      directories: 'Verzeichnisse',
      earned: 'Earned Media',
      entity: 'Entität',
    },
    noPrompts: (name) => `${name} wird in keinem gemessenen Prompt dieser Stichprobe genannt.`,
    noQuote: (name) => `Kein Textbeleg — ${name} kommt in keiner gemessenen Antwort vor.`,
    noTeardown: (name) => `Keine gespeicherte Wettbewerber-Analyse zu ${name} — keine Daten.`,
    noPages: (name) => `Keine erfassten Seiten unter der Domain von ${name} — keine Daten.`,
    noCompetitors:
      'In dieser Stichprobe wurde kein belegter Wettbewerber gemessen — kein Abstandsvergleich möglich.',
    quoteMeta: (engine, prompt) => `${engine} · «${prompt}»`,
    sampleBaseNote: (answers, citations) =>
      `Prozentwerte im Fliesstext beziehen sich auf die Stichprobe dieses Berichts: ${answers} gemessene Antworten, ${citations} Zitationen.`,
    thGapPts: 'Abstand (Punkte)',
    thGapCount: 'Abstand (Nennungen)',
    ownCitationsTitle: 'Eigene zitierte Seiten',
    noOwnCitations: (name) =>
      `Keine gemessene Antwort verlinkt auf eine Seite von ${name} — keine Daten.`,
    missedTitle: (name) => `Verlorene Prompts — ${name} nicht genannt`,
    missedMeta: (runs) => `0 von ${runs} Antworten`,
    missedRivals: 'stattdessen genannt',
    noMissed: 'Keine gemessenen Prompts ohne Nennung — keine Daten.',
    shapesTitle: 'Antwortformate der Engines',
    shapesCaption: (n) => `Basis: ${n} analysierte Antworten`,
    thShape: 'Format',
    thAnswers: 'Antworten',
    thChars: 'Ø Zeichen',
    thCitedUrls: 'Ø Quellen',
    clientProfile: (name) => `Kundenprofil — ${name}`,
    competitorsTitle: 'Wettbewerber',
    competitorTag: (i) => `Wettbewerber #${i}`,
    rankWord: 'Rang',
    statLine: (m, c, sov, rank) =>
      `Erwähnung ${m} · Zitation ${c} · Share of Voice ${sov}${rank ? ` · Ø Rang ${rank}` : ''}`,
    thEngine: 'Engine',
    thMention: 'Erwähnung',
    thCitation: 'Zitation',
    thSov: 'SoV',
    thRank: 'Ø Rang',
    thRuns: 'Antworten',
    thN: 'N',
    lowSample: (minN) =>
      `Kleine Stichprobe: mindestens eine Engine mit nur ${minN} gemessenen Antworten — Raten sind grobkörnig, Richtwerte statt Feinmessung.`,
    totalRow: 'Gesamt',
    chartCaption:
      'Balkenlänge = Anteil der gemessenen Antworten, Beschriftung = Treffer / Basis',
    summaryTitle: 'Marktvergleich — Erwähnungen pro Engine',
    summaryCaption:
      'Alle gemessenen Marken auf gleicher Skala; Beschriftung = Nennungen / gemessene Antworten',
    findingsTitle: 'Befunde',
    engineDetailTitle: (name) => `Detail pro Engine — ${name}`,
    topicsTitle: 'Themenprofil',
    thTopic: 'Themencluster',
    thPrompts: 'Prompts',
    topicLabel: TOPIC_DE,
    analysisTitle: 'Einordnung',
    avatarLensNote:
      'Avatar-Linse: alle Werte aus Prompts in der Sprache und Perspektive der Zielgruppe — ohne Wettbewerber-Vergleichsdaten in diesem Ausschnitt.',
    sourcesTitle: 'Quellen & Markt',
    supplyTitle: 'Zitationsquellen — Top-Domains',
    thDomain: 'Domain',
    thClass: 'Klasse',
    thCitations: 'Zitationen',
    thShare: 'Anteil',
    clsOwn: 'Eigene',
    clsDirectory: 'Verzeichnis',
    clsEarned: 'Earned Media',
    clsOther: 'Andere',
    sovTitle: 'Share of Voice — alle Marken',
    sovCaption: (total) => `Basis: ${total} Marken-Nennungen über alle gemessenen Antworten`,
    othersLabel: 'Andere',
    sourceFindingsTitle: 'Befunde',
    closeTitle: 'Ergebnis & nächste Schritte',
    resultKicker: 'Das Ergebnis',
    impactLine: (leads, chf) =>
      `Modellierter Impact: ${leads} entgangene Leads · CHF ${chf} Umsatzrisiko pro Monat — modelliert, nicht gemessen.`,
    next90Title: 'Die nächsten 90 Tage',
    horizon: { p1: 'Woche 1–2', p2: 'Woche 3–4', p3: 'laufend' },
    stepEffect: {
      p1: 'Erwarteter Effekt: erste zitierfähige Antwortseiten live, Grundlage für Zitationen gelegt.',
      p2: 'Erwarteter Effekt: breitere Abdeckung der Zielfragen über alle vier Engines.',
      p3: 'Erwarteter Effekt: Erwähnung und Zitation steigen messbar im nächsten Audit.',
    },
    newPage: (t) => `Neue Antwortseite «${t}»`,
    gapPageTitle: 'Die Lücke',
    gapQuestionsTitle: 'Fragen, die andere beantworten',
    gapQuestionsNote:
      'Gemessene Fragen ohne eine einzige Nennung der Marke — die Antwort geht an den Wettbewerb.',
    gapLeadLabel: 'Grösster Abstand zu',
    gapLeadUnit: 'Prozentpunkte Erwähnungsrate',
    methodStrip: (engines, answers) => [
      `Engines: ${engines}`,
      `Stichprobe: ${answers} gemessene Antworten`,
      'Erwähnung: Marke im Antworttext',
      'Zitation: Link auf eigene Domain',
      'SoV: Marken-Nennungen ÷ alle Nennungen',
      'Fehlende Werte: n/a — nie geschätzt',
      'Impact-Zahlen modelliert, keine Messwerte',
    ],
    closingBrand: 'LeadEngine',
  },
  en: {
    kicker: 'AI-Visibility Audit',
    variantGeneral: 'Market Overview',
    variantAvatar: 'Avatar Lens',
    liveTested: (d) => `Live-tested ${d}`,
    footerLeft: (c, v) => `AI-Visibility Audit — ${c} · ${v}`,
    pageOf: (n, t) => `Page ${n} of ${t}`,
    na: 'n/a',
    titleLine: 'Visibility in AI answers',
    coverSub: (sector, locations, engines, runs) =>
      `${sector} · ${locations}\n${runs} live-measured AI answers across ${engines} engines`,
    statMention: 'Mention rate',
    statCitation: 'Citation rate',
    statSov: 'Share of Voice',
    statRank: 'Avg. rank when named',
    tocTitle: 'Contents',
    tocClient: (name) => `Client profile — ${name}`,
    tocCompetitors: (a, b) => `Competitors #${a} and #${b}`,
    tocCompetitorOne: (i) => `Competitor #${i}`,
    tocMarket: 'Market comparison — all brands',
    tocEngineDetail: 'Detail per engine',
    tocTopics: 'Topic profile',
    tocSources: 'Sources & market',
    tocClose: 'Result & next steps',
    verdictKicker: 'The Verdict',
    ci95: (lo, hi) => `95% CI ${lo}–${hi}`,
    countsFirstNote:
      'How to read this: every figure is a percentage share of the AI answers measured for this report. The full sample is stated in the methodology on the last page.',
    minDenomNote: (min) =>
      `Base below ${min} answers: no percentage is quoted (n/a) — on a base that small any percentage would mislead.`,
    ofAnswers: (k, n) => `${k} of ${n} measured answers`,
    namedIn: (k, n) => `named in ${k} of ${n} answers`,
    namedInPct: (pct) => `named in ${pct} of answers`,
    sovOf: (k, n) => `${k} of ${n} brand mentions`,
    entityTitle: (i, name) => `Competitor #${i} — ${name}`,
    tocEntity: (i, name) => `Competitor #${i} — ${name}`,
    tocClientEvidence: 'Evidence & gap to the field',
    clientEvidenceTitle: (name) => `Evidence & gap to the field — ${name}`,
    whereWinTitle: 'Where they win',
    whyWinTitle: 'Why they win',
    tacticsTitle: 'Tactics',
    citedPagesTitle: 'Their captured pages',
    quoteTitle: 'Verbatim evidence',
    gapTitle: (name) => `Gap — ${name} against the field`,
    thCompetitor: 'Competitor',
    thGap: 'Gap',
    promptsNamedTitle: (name) => `Prompts where ${name} is named`,
    topicStrengthTitle: 'Strongest topic clusters',
    formatWord: {
      faq: 'FAQ format',
      table: 'Table format',
      list: 'List format',
      prose: 'Prose',
    },
    wordsCount: (n) => `${n} words`,
    sigFaq: 'FAQ block',
    sigTable: 'Comparison table',
    sigStats: 'Figures & statistics',
    sigSchema: (types) => `Schema: ${types}`,
    sigNone: 'no structural signals captured',
    tacticLabel: {
      content: 'Content',
      schema: 'Schema',
      directories: 'Directories',
      earned: 'Earned media',
      entity: 'Entity',
    },
    noPrompts: (name) => `${name} is not named in any measured prompt of this sample.`,
    noQuote: (name) => `No verbatim evidence — ${name} appears in no measured answer.`,
    noTeardown: (name) => `No stored competitor teardown for ${name} — no data.`,
    noPages: (name) => `No captured pages under the domain of ${name} — no data.`,
    noCompetitors:
      'No evidence-backed competitor was measured in this sample — no gap comparison possible.',
    quoteMeta: (engine, prompt) => `${engine} · "${prompt}"`,
    sampleBaseNote: (answers, citations) =>
      `Percentages in the running text refer to this report's sample: ${answers} measured answers, ${citations} citations.`,
    thGapPts: 'Gap (points)',
    thGapCount: 'Gap (mentions)',
    ownCitationsTitle: 'Own cited pages',
    noOwnCitations: (name) => `No measured answer links to a page of ${name} — no data.`,
    missedTitle: (name) => `Lost prompts — ${name} not named`,
    missedMeta: (runs) => `0 of ${runs} answers`,
    missedRivals: 'named instead',
    noMissed: 'No measured prompt without a mention — no data.',
    shapesTitle: 'Answer formats of the engines',
    shapesCaption: (n) => `Base: ${n} analyzed answers`,
    thShape: 'Format',
    thAnswers: 'Answers',
    thChars: 'Avg. characters',
    thCitedUrls: 'Avg. sources',
    clientProfile: (name) => `Client profile — ${name}`,
    competitorsTitle: 'Competitors',
    competitorTag: (i) => `Competitor #${i}`,
    rankWord: 'Rank',
    statLine: (m, c, sov, rank) =>
      `Mention ${m} · Citation ${c} · Share of Voice ${sov}${rank ? ` · avg. rank ${rank}` : ''}`,
    thEngine: 'Engine',
    thMention: 'Mention',
    thCitation: 'Citation',
    thSov: 'SoV',
    thRank: 'Avg. rank',
    thRuns: 'Answers',
    thN: 'N',
    lowSample: (minN) =>
      `Small sample: at least one engine measured on only ${minN} answers — rates are coarse; read as direction, not precision.`,
    totalRow: 'Overall',
    chartCaption: 'Bar length = share of measured answers, label = hits / base',
    summaryTitle: 'Market comparison — mentions per engine',
    summaryCaption: 'All measured brands on one scale; label = mentions / measured answers',
    findingsTitle: 'Findings',
    engineDetailTitle: (name) => `Detail per engine — ${name}`,
    topicsTitle: 'Topic profile',
    thTopic: 'Topic cluster',
    thPrompts: 'Prompts',
    topicLabel: TOPIC_EN,
    analysisTitle: 'Context',
    avatarLensNote:
      'Avatar lens: all values from prompts in the language and perspective of the target audience — no competitor comparison data in this slice.',
    sourcesTitle: 'Sources & market',
    supplyTitle: 'Citation sources — top domains',
    thDomain: 'Domain',
    thClass: 'Class',
    thCitations: 'Citations',
    thShare: 'Share',
    clsOwn: 'Own',
    clsDirectory: 'Directory',
    clsEarned: 'Earned media',
    clsOther: 'Other',
    sovTitle: 'Share of Voice — all brands',
    sovCaption: (total) => `Base: ${total} brand mentions across all measured answers`,
    othersLabel: 'Others',
    sourceFindingsTitle: 'Findings',
    closeTitle: 'Result & next steps',
    resultKicker: 'The Result',
    impactLine: (leads, chf) =>
      `Modeled impact: ${leads} lost leads · CHF ${chf} revenue at risk per month — modeled, not measured.`,
    next90Title: 'The next 90 days',
    horizon: { p1: 'Weeks 1–2', p2: 'Weeks 3–4', p3: 'ongoing' },
    stepEffect: {
      p1: 'Expected effect: first citable answer pages live, the foundation for citations in place.',
      p2: 'Expected effect: broader coverage of the target queries across all four engines.',
      p3: 'Expected effect: mention and citation rise measurably in the next audit.',
    },
    newPage: (t) => `New answer page "${t}"`,
    gapPageTitle: 'The gap',
    gapQuestionsTitle: 'Questions answered by someone else',
    gapQuestionsNote:
      'Measured questions with not a single mention of the brand — the answer goes to a competitor.',
    gapLeadLabel: 'Largest distance to',
    gapLeadUnit: 'points of mention rate',
    methodStrip: (engines, answers) => [
      `Engines: ${engines}`,
      `Sample: ${answers} measured answers`,
      'Mention: brand in answer text',
      'Citation: link to own domain',
      'SoV: brand mentions ÷ all mentions',
      'Missing values: n/a — never estimated',
      'Impact figures modeled, not measured',
    ],
    closingBrand: 'LeadEngine',
  },
}

// ─── Action Plan (mission briefing) ─────────────────────────────────────────

/** String table for the lavender GEO Action Plan PDF (actionplan.ts). */
export interface ApStr {
  kicker: string
  docTitle: string
  missionKicker: string
  mission: (pages: number, name: string) => string
  kpiPages: string
  kpiDirs: string
  kpiPrio: string
  phasesTitle: string
  phases: { tag: string; title: string; desc: string }[]
  s1: string
  s2: string
  s3: string
  targetQuery: string
  schemaTitle: string
  dirTitle: string
  entityTitle: string
  naNone: string
  contextTitle: string
  kpiTitle: string
  benchmark: string
  ga4Title: string
  snippetTitle: string
  closing: (name: string) => string
  closingTag: string
  morePages: (n: number) => string
  footerLeft: (client: string) => string
  pageOf: (n: number, total: number) => string
  thDirectory: string
  thAction: string
  thUrl: string
  actionWord: Record<'claim' | 'create' | 'update', string>
}

export const AP_STR: Record<ReportLang, ApStr> = {
  de: {
    kicker: 'GEO Action Plan',
    docTitle: 'GEO Action Plan',
    missionKicker: 'Die Mission',
    mission: (pages, name) =>
      `${pages} Antwortseiten machen ${name} zur zitierfähigen Quelle für KI-Antworten.`,
    kpiPages: 'geplante Seiten',
    kpiDirs: 'Verzeichnisse',
    kpiPrio: 'Top-Prio Seiten',
    phasesTitle: 'Phasen',
    phases: [
      { tag: 'Woche 1–2', title: 'Fundament', desc: 'Top-Prio Seiten live, Schema gesetzt' },
      { tag: 'Woche 3–4', title: 'Ausbau', desc: 'Restliche Seiten, Verzeichnisse, Entitäten' },
      { tag: 'laufend', title: 'Messung', desc: 'Wöchentliche KPIs, Nachschärfen der Inhalte' },
    ],
    s1: 'Seiten-Roadmap',
    s2: 'Schema · Verzeichnisse · Entitäten',
    s3: 'Messung & KPIs',
    targetQuery: 'Zielquery',
    schemaTitle: 'Schema-Snippets',
    dirTitle: 'Verzeichnisse',
    entityTitle: 'Entitäts-Aufgaben',
    naNone: 'n/a — keine geplant',
    contextTitle: 'Kontext — warum Wettbewerber gewinnen',
    kpiTitle: 'Wöchentliche KPIs',
    benchmark: 'Benchmark',
    ga4Title: 'GA4-Segmente — KI-Referrer',
    snippetTitle: 'Tracking-Setup',
    closing: (name) => `Bereit zur Umsetzung — jede Seite bringt ${name} näher an die KI-Antwort.`,
    closingTag: 'Nächster Schritt: Freigabe',
    morePages: (n) => `+${n} weitere Seiten im Plan`,
    footerLeft: (c) => `GEO Action Plan — ${c}`,
    pageOf: (n, t) => `Seite ${n} von ${t}`,
    thDirectory: 'Verzeichnis',
    thAction: 'Aktion',
    thUrl: 'URL',
    actionWord: { claim: 'übernehmen', create: 'anlegen', update: 'aktualisieren' },
  },
  en: {
    kicker: 'GEO Action Plan',
    docTitle: 'GEO Action Plan',
    missionKicker: 'The Mission',
    mission: (pages, name) =>
      `${pages} answer pages turn ${name} into a citable source for AI answers.`,
    kpiPages: 'pages planned',
    kpiDirs: 'directories',
    kpiPrio: 'top-priority pages',
    phasesTitle: 'Phases',
    phases: [
      { tag: 'Weeks 1–2', title: 'Foundation', desc: 'Top-priority pages live, schema in place' },
      { tag: 'Weeks 3–4', title: 'Build-out', desc: 'Remaining pages, directories, entities' },
      { tag: 'ongoing', title: 'Measurement', desc: 'Weekly KPIs, content sharpening' },
    ],
    s1: 'Page roadmap',
    s2: 'Schema · Directories · Entities',
    s3: 'Measurement & KPIs',
    targetQuery: 'Target query',
    schemaTitle: 'Schema snippets',
    dirTitle: 'Directories',
    entityTitle: 'Entity tasks',
    naNone: 'n/a — none planned',
    contextTitle: 'Context — why competitors win',
    kpiTitle: 'Weekly KPIs',
    benchmark: 'Benchmark',
    ga4Title: 'GA4 segments — AI referrers',
    snippetTitle: 'Tracking setup',
    closing: (name) => `Ready to execute — every page moves ${name} closer to the AI answer.`,
    closingTag: 'Next step: approval',
    morePages: (n) => `+${n} more pages in the plan`,
    footerLeft: (c) => `GEO Action Plan — ${c}`,
    pageOf: (n, t) => `Page ${n} of ${t}`,
    thDirectory: 'Directory',
    thAction: 'Action',
    thUrl: 'URL',
    actionWord: { claim: 'claim', create: 'create', update: 'update' },
  },
}
