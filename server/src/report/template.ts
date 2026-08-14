/**
 * template.ts — the AI-Visibility Intelligence Dossier (full redesign).
 *
 * A ~12-page dark dossier rendered per language (de/en) and per persona
 * family ('general' market overview vs 'avatar' target-audience lens):
 *
 *   P1  Cover / verdict — composite AI Visibility Index (ring gauge),
 *       verdict sentence, 6-tile KPI wall, audit metadata strip
 *   P2  Engine battlefield — per-engine stat cards + engine × metric heat matrix
 *   P3  Market leaderboard — share-of-mentions ranking + top-threat callout
 *   P4  Three Gates diagnostic — fetchable → chosen → extractable pipeline
 *       + citation-mix band + weakest-gate takeaway
 *   P5  Citation supply chain — ranked domain table with class chips, hubs,
 *       visibility–citation gap banner              (needs evidence)
 *   P6  Topic × engine matrix + topic cluster cards + answer-shape table
 *                                                    (needs evidence)
 *   P7  Geo & persona lens — stepped geo ladder + persona split + avatar card
 *   P8  Sentiment & narrative — segmented band, per-engine positives,
 *       trend sparkline, narrative pulls             (needs sentiment)
 *   P9  Competitor teardown — most-cited pages + winning patterns
 *                                                    (needs competitorPages)
 *   P10 Evidence log — verbatim prompt/answer exhibits with verification dots
 *                                                    (needs evidence)
 *   P11 Roadmap & impact — P1/P2/P3 action blocks, modeled impact (footnoted),
 *       closer banner
 *   P12 Methodology — engines, sampling, metric formulas, honest limitations
 *
 * Composite index (documented on P1 + P12):
 *   AI Visibility Index = 0.40·mentionRate + 0.35·citationRate + 0.25·SoV
 *
 * Every figure comes from DeckInput — nothing is invented. Sections with no
 * data are skipped and page numbering stays continuous. Impact figures are
 * MODELED and always footnoted as such. Layout: A4, 18mm margins, top-down
 * PDFKit points, all measurements in mm via MM.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type PDFDocument from 'pdfkit'

import type {
  AuditRecord,
  AuditScore,
  Company,
  CompetitorPage,
  Engine,
  EngineStats,
  ImpactModel,
  ReportEvidence,
  ReportLang,
  ReportSections,
  SentimentReport,
  TopicKey,
} from '../types.js'
import { tierMention } from '../core/scoring.js'
import { clientPattern } from '../core/regex.js'
import { DIRECTORY_DOMAINS, EARNED_HINTS, domainOf } from '../core/citations.js'
import {
  MM,
  THEME,
  chip,
  deltaChip,
  statTile,
  sectionHead,
  heatMatrix,
  segmentedBand,
  sparkline,
  steppedLadder,
  pipeline,
  rankedBars,
  ringGauge,
  type GateStatus,
  type PipelineNode,
  type RankedRow,
  GATE_COLOR,
} from './charts.js'

type Doc = InstanceType<typeof PDFDocument>

// ─── Geometry ───────────────────────────────────────────────────────────────

const W = 595.28
const H = 841.89
const M = 18 * MM
const CW = W - 2 * M

const LOGO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'fm_logo.png',
)
const LOGO_RATIO = 546 / 105

const ENGS: Engine[] = ['chatgpt', 'gemini', 'perplexity', 'claude']
const ENG_LABEL: Record<Engine, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  claude: 'Claude',
}
const GEO_ORDER = ['city', 'region', 'canton', 'cantons', 'ch'] as const

// ─── String tables (Swiss German — no ß) ────────────────────────────────────

const GEO_LABEL: Record<ReportLang, Record<(typeof GEO_ORDER)[number], string>> = {
  de: { city: 'Stadt', region: 'Region', canton: 'Kanton', cantons: 'Deutschschweiz', ch: 'Schweiz' },
  en: { city: 'City', region: 'Region', canton: 'Canton', cantons: 'German CH', ch: 'Switzerland' },
}

const TOPIC_LABEL: Record<ReportLang, Record<TopicKey, string>> = {
  de: {
    pricing: 'Preise & Kosten',
    comparison: 'Vergleiche',
    local: 'Lokal & regional',
    service: 'Leistungen',
    general: 'Allgemein',
  },
  en: {
    pricing: 'Pricing & cost',
    comparison: 'Comparisons',
    local: 'Local & regional',
    service: 'Services',
    general: 'General',
  },
}

const FORMAT_LABEL: Record<ReportLang, Record<NonNullable<CompetitorPage['answerFormat']>, string>> = {
  de: { faq: 'FAQ', table: 'Tabelle', list: 'Liste', prose: 'Fliesstext' },
  en: { faq: 'FAQ', table: 'Table', list: 'List', prose: 'Prose' },
}

interface Str {
  // chrome
  dossier: string
  confidential: string
  footerLeft: string
  generated: string
  pageOf: (p: number, t: number) => string
  variantGeneral: string
  variantAvatar: string
  // cover
  coverAudit: string
  liveTested: (date: string) => string
  indexLabel: string
  of100: string
  verdictKicker: string
  verdictBand: (index: number) => string
  verdictBody: (v: {
    index: number
    company: string
    mention: string
    citation: string
    topSov: string
    engines: number
  }) => string
  formulaNote: string
  kMention: string
  kCitation: string
  kSov: string
  kRank: string
  kRuns: string
  kEngines: string
  kMentionSub: string
  kCitationSub: string
  kSovSub: string
  kRankSub: string
  kRunsSub: string
  kEnginesSub: string
  mLocations: string
  mPrompts: string
  mEngines: string
  mVariant: string
  tocTitle: string
  avatarKicker: string
  avatarLede: (persona: string) => string
  // p2 engines
  p2Kicker: string
  p2Title: string
  p2Lede: string
  runsShort: string
  rankShort: string
  heatTitle: string
  heatNote: string
  readingTitle: string
  // p3 leaderboard
  p3Kicker: string
  p3Title: string
  p3Lede: string
  threatKicker: string
  threatBody: (v: { name: string; topSov: string; sov: string }) => string
  signalsTitle: string
  youSuffix: string
  // p4 gates
  p4Kicker: string
  p4Title: string
  p4Lede: string
  gates: [PipelineText, PipelineText, PipelineText]
  statusPass: string
  statusWarn: string
  statusFail: string
  gateExplainer: string
  mixTitle: string
  classOwn: string
  classDir: string
  classEarned: string
  classOther: string
  weakKicker: string
  weakSentence: (gate: 0 | 1 | 2, v: { own: number; mention: string; citation: string }) => string
  // p5 supply chain
  p5Kicker: string
  p5Title: string
  p5Lede: string
  supDomain: string
  supClass: string
  supCites: string
  supComp: string
  supTopics: string
  hubsTitle: string
  hubLine: (domain: string, citations: number, comps: string) => string
  gapKicker: string
  gapBody: (v: { mention: string; citation: string }) => string
  // p6 topics
  p6Kicker: string
  p6Title: string
  p6Lede: string
  clusterTitle: string
  runsLabel: (n: number) => string
  shapesTitle: string
  shapeHeaders: string[]
  prevalenceLine: (v: { lists: number; tables: number; numbers: number; avgChars: number; answers: number }) => string
  // p7 geo & persona
  p7Kicker: string
  p7Title: string
  ladderTitle: string
  personaTitle: string
  personaGeneral: string
  personaAvatar: string
  personaGeneralSub: string
  personaAvatarSub: string
  avatarNoteGeneral: string
  insightsTitle: string
  // p8 sentiment
  p8Kicker: string
  p8Title: string
  p8Lede: string
  pos: string
  neu: string
  neg: string
  engPosTitle: string
  posShare: string
  trendTitle: string
  narrativeTitle: string
  // p9 teardown
  p9Kicker: string
  p9Title: string
  p9Lede: string
  citations: string
  words: string
  chipFaq: string
  chipTable: string
  chipStats: string
  chipSchema: string
  patternsTitle: string
  patSchema: (p: number) => string
  patFaq: (p: number) => string
  patLong: (p: number) => string
  patTable: (p: number) => string
  patStats: (p: number) => string
  patFormat: (f: string, p: number) => string
  // p10 evidence
  p10Kicker: string
  p10Title: string
  p10Lede: string
  evCited: string
  evMentioned: string
  evInvisible: string
  evSources: string
  // p11 roadmap
  p11Kicker: string
  p11Title: string
  prio: [string, string, string]
  impactTitle: string
  impClicks: string
  impLeads: string
  impChf: string
  impClicksSub: string
  impLeadsSub: string
  impChfSub: string
  impCompNote: (leads: number, chf: string) => string
  impAssumptions: (v: { value: string; queries: string; ctr: string; conv: string }) => string
  closerKicker: string
  // p12 methodology
  p12Kicker: string
  p12Title: string
  meth: { title: string; body: (c: MethodVars) => string }[]
  contact: string
}

interface PipelineText {
  kicker: string
  title: string
  note: string
}

interface MethodVars {
  engines: string
  runs: number
  prompts: number
  locations: string
  date: string
  assumptions: ImpactModel['assumptions']
}

const S: Record<ReportLang, Str> = {
  de: {
    dossier: 'AI-VISIBILITY-DOSSIER',
    confidential: 'VERTRAULICH',
    footerLeft: 'Future Media · LeadEngine — Vertraulich',
    generated: 'Erstellt am',
    pageOf: (p, t) => `${String(p).padStart(2, '0')} / ${String(t).padStart(2, '0')}`,
    variantGeneral: 'Marktübersicht',
    variantAvatar: 'Avatar-Linse',
    coverAudit: 'AI SEARCH AUDIT',
    liveTested: (d) => `LIVE GETESTET · ${d}`,
    indexLabel: 'AI VISIBILITY INDEX',
    of100: 'VON 100',
    verdictKicker: 'DAS URTEIL',
    verdictBand: (i) =>
      i >= 65
        ? 'Führend im KI-Kanal — jetzt den Vorsprung absichern.'
        : i >= 40
          ? 'Sichtbar, aber angreifbar — die Lücken sind messbar.'
          : i >= 18
            ? 'Im Aufbau — unbeantwortete Nachfrage fliesst zur Konkurrenz.'
            : 'Kritisch untersichtbar — die KI-Suche findet Sie kaum.',
    verdictBody: (v) =>
      `Index ${v.index}/100: ${v.company} wird in ${v.mention} der Testläufe genannt, ` +
      `aber nur in ${v.citation} als Quelle zitiert. Der stärkste Wettbewerber hält ` +
      `${v.topSov} Share of Voice — gemessen über ${v.engines} KI-Engines.`,
    formulaNote:
      'Index = 0.40 × Erwähnungsrate + 0.35 × Zitationsrate + 0.25 × Share of Voice. Berechnet ausschliesslich aus den Live-Testläufen dieses Audits.',
    kMention: 'Erwähnungsrate',
    kCitation: 'Zitationsrate',
    kSov: 'Share of Voice',
    kRank: 'Ø Rang',
    kRuns: 'Testläufe',
    kEngines: 'Engines',
    kMentionSub: 'Antworten, die Sie nennen',
    kCitationSub: 'Antworten, die Sie verlinken',
    kSovSub: 'Anteil aller Markennennungen',
    kRankSub: 'Position, wenn genannt',
    kRunsSub: 'erfolgreich ausgewertet',
    kEnginesSub: 'live abgefragt',
    mLocations: 'STANDORTE',
    mPrompts: 'PROMPTS',
    mEngines: 'ENGINES',
    mVariant: 'PERSPEKTIVE',
    tocTitle: 'INHALT',
    avatarKicker: 'IHR AVATAR',
    avatarLede: (p) => `Alle Messwerte in diesem Dossier aus Sicht von: ${p}`,
    p2Kicker: 'ENGINE-ARENA',
    p2Title: 'Das Engine-Schlachtfeld',
    p2Lede: 'Jede Engine ist ein eigener Markt — Sichtbarkeit vererbt sich nicht.',
    runsShort: 'Läufe',
    rankShort: 'Rang',
    heatTitle: 'Heat-Matrix — Engine × Metrik',
    heatNote: 'Zellfarbe relativ zum Maximum der Matrix — je heller, desto stärker.',
    readingTitle: 'Lesart',
    p3Kicker: 'MARKT',
    p3Title: 'Die Marktrangliste',
    p3Lede: 'Anteil an KI-Erwähnungen über alle ausgewerteten Testläufe.',
    threatKicker: 'GRÖSSTE BEDROHUNG',
    threatBody: (v) =>
      `${v.name} dominiert mit ${v.topSov} Share of Voice — Sie halten ${v.sov}. Jede unbeantwortete Anfrage zahlt auf dieses Konto ein.`,
    signalsTitle: 'Markt-Signale',
    youSuffix: ' (Sie)',
    p4Kicker: 'DIAGNOSE',
    p4Title: 'Die drei Tore der KI-Sichtbarkeit',
    p4Lede: 'Eine Marke gewinnt nur, wenn sie alle drei Tore nacheinander passiert.',
    gates: [
      {
        kicker: 'TOR 1 · AUFFINDBAR',
        title: 'Gefunden werden',
        note: 'Die Engines müssen Ihre eigenen Seiten als Quelle laden. Gemessen: Zitationen Ihrer Domain im Quellen-Mix.',
      },
      {
        kicker: 'TOR 2 · AUSGEWÄHLT',
        title: 'Genannt werden',
        note: 'Das Modell muss Sie in die Antwort aufnehmen. Gemessen: Erwähnungsrate über alle Testläufe.',
      },
      {
        kicker: 'TOR 3 · EXTRAHIERBAR',
        title: 'Zitiert werden',
        note: 'Die Antwort muss auf Sie verlinken — dort entsteht der Klick. Gemessen: Zitationsrate über alle Testläufe.',
      },
    ],
    statusPass: 'ERFÜLLT',
    statusWarn: 'TEILWEISE',
    statusFail: 'VERFEHLT',
    gateExplainer:
      'Auffindbar heisst: die Engines greifen beim Antworten auf Ihre Domain zu. Ausgewählt heisst: Ihr Name steht in der Antwort. Extrahierbar heisst: die Antwort verlinkt Sie als Quelle. Jedes Tor filtert — wer am dritten scheitert, bleibt Traffic-los, auch wenn er genannt wird.',
    mixTitle: 'Zitations-Mix — wem die Engines vertrauen',
    classOwn: 'Eigene Domain',
    classDir: 'Verzeichnisse',
    classEarned: 'Earned Media',
    classOther: 'Übrige',
    weakKicker: 'SCHWÄCHSTES TOR',
    weakSentence: (g, v) =>
      g === 0
        ? `Ihre eigene Domain taucht nur ${v.own}× im Quellen-Mix auf — die Engines beantworten Ihre Themen mit fremden Seiten.`
        : g === 1
          ? `Mit ${v.mention} Erwähnungsrate werden Sie in den meisten Antworten schlicht nicht genannt — Entity-Aufbau ist der erste Hebel.`
          : `Sie werden genannt (${v.mention}), aber kaum verlinkt (${v.citation}) — es fehlt an zitierfähigen, maschinenlesbaren Inhalten.`,
    p5Kicker: 'QUELLEN',
    p5Title: 'Die Zitations-Lieferkette',
    p5Lede: 'Diese Domains liefern den Engines die Antworten auf Ihre Themen.',
    supDomain: 'DOMAIN',
    supClass: 'KLASSE',
    supCites: 'ZITATIONEN',
    supComp: 'WETTBEWERBER IM KONTEXT',
    supTopics: 'THEMEN',
    hubsTitle: 'Zitations-Hubs — eine Platzierung, mehrfacher Effekt',
    hubLine: (d, c, comps) => `${d} — ${c} Zitationen · versorgt: ${comps}`,
    gapKicker: 'SICHTBARKEITS-ZITATIONS-LÜCKE',
    gapBody: (v) =>
      `${v.mention} Erwähnung, aber nur ${v.citation} Zitation: Ihre Marke lebt auf fremden Seiten. Die Engines kennen Sie — aber der Klick landet bei Dritten.`,
    p6Kicker: 'THEMEN',
    p6Title: 'Thema × Engine',
    p6Lede: 'Erwähnungsrate pro Themen-Cluster und Engine — wo Sie stattfinden und wo nicht.',
    clusterTitle: 'Themen-Cluster',
    runsLabel: (n) => `${n} Läufe`,
    shapesTitle: 'Antwortformate — welche Form zitiert wird',
    shapeHeaders: ['FORMAT', 'ANTWORTEN', 'Ø ZEICHEN', 'Ø QUELLEN', 'ZITATION', 'ERWÄHNUNG'],
    prevalenceLine: (v) =>
      `Verbreitung: Listen ${v.lists}% · Tabellen ${v.tables}% · Zahlen ${v.numbers}% · Ø ${v.avgChars} Zeichen — über ${v.answers} analysierte Antworten.`,
    p7Kicker: 'GEO & PERSONA',
    p7Title: 'Wo — und für wen — Sie sichtbar sind',
    ladderTitle: 'Geo-Leiter — Erwähnungsrate nach Suchradius',
    personaTitle: 'Persona-Split — wer Sie findet',
    personaGeneral: 'Allgemeine Suche',
    personaAvatar: 'Käufer-Avatar',
    personaGeneralSub: 'Erwähnungsrate, generische Prompts',
    personaAvatarSub: 'Erwähnungsrate, Avatar-Prompts',
    avatarNoteGeneral: 'Die Avatar-Ausgabe dieses Dossiers misst dieselben Fragen aus Sicht Ihres Käufer-Avatars:',
    insightsTitle: 'Kern-Einsichten',
    p8Kicker: 'TONALITÄT',
    p8Title: 'Sentiment & Narrativ',
    p8Lede: 'Wie die KI-Antworten über Sie sprechen, wenn sie über Sie sprechen.',
    pos: 'positiv',
    neu: 'neutral',
    neg: 'negativ',
    engPosTitle: 'Positiv-Anteil nach Engine',
    posShare: 'positiv',
    trendTitle: 'Trend — Positiv-Anteil über die Audit-Tage',
    narrativeTitle: 'Narrativ-Signale',
    p9Kicker: 'KONKURRENZ',
    p9Title: 'Wettbewerber-Teardown',
    p9Lede: 'Die Seiten, die die Engines für Ihre Wettbewerber zitieren — und warum.',
    citations: 'Zitationen',
    words: 'Wörter',
    chipFaq: 'FAQ',
    chipTable: 'Tabelle',
    chipStats: 'Statistiken',
    chipSchema: 'Schema',
    patternsTitle: 'Muster der Gewinner-Seiten',
    patSchema: (p) => `${p}% nutzen JSON-LD Schema-Markup`,
    patFaq: (p) => `${p}% führen einen FAQ-Bereich`,
    patLong: (p) => `${p}% haben 1500+ Wörter`,
    patTable: (p) => `${p}% setzen Vergleichstabellen ein`,
    patStats: (p) => `${p}% nennen Statistiken oder Preise`,
    patFormat: (f, p) => `${p}% setzen auf das Format «${f}»`,
    p10Kicker: 'BEWEISE',
    p10Title: 'Das Evidenz-Protokoll',
    p10Lede: 'Verbatim-Auszüge. Quellen-Punkte: grün = verifiziert, zitiert Sie · rot = geprüft, zitiert Sie nicht · grau = ungeprüft.',
    evCited: 'ZITIERT',
    evMentioned: 'ERWÄHNT',
    evInvisible: 'UNSICHTBAR',
    evSources: 'Quellen',
    p11Kicker: 'FAHRPLAN',
    p11Title: 'Roadmap & modellierte Wirkung',
    prio: ['P1 · SOFORT (0–30 TAGE)', 'P2 · AUFBAU (30–90 TAGE)', 'P3 · AUSBAU (90+ TAGE)'],
    impactTitle: 'Modellierte Wirkung — nicht gemessen',
    impClicks: 'Umgeleitete Klicks',
    impLeads: 'Verlorene Anfragen',
    impChf: 'Entgangener Wert',
    impClicksSub: 'pro Monat, modelliert',
    impLeadsSub: 'pro Monat, modelliert',
    impChfSub: 'CHF pro Monat, modelliert',
    impCompNote: (l, c) => `Davon fangen Wettbewerber heute ~${l} Anfragen (~CHF ${c}) pro Monat ab.`,
    impAssumptions: (v) =>
      `Modell-Annahmen: CHF ${v.value} Projektwert · ${v.queries} KI-Suchanfragen/Monat · ${v.ctr} CTR · ${v.conv} Conversion. Modellwerte, keine Messwerte.`,
    closerKicker: 'FAZIT',
    p12Kicker: 'METHODIK',
    p12Title: 'Methodik & Grenzen',
    meth: [
      {
        title: 'Engines & Modelle',
        body: (c) =>
          `Live abgefragt wurden ${c.engines} über die offiziellen APIs. ${c.runs} Testläufe wurden erfolgreich ausgewertet; fehlgeschlagene Läufe fliessen in keine Kennzahl ein.`,
      },
      {
        title: 'Stichprobe',
        body: (c) =>
          `${c.prompts} geo-gestaffelte Prompts (Stadt › Region › Kanton › Deutschschweiz › Schweiz) in zwei Personas (allgemein / Käufer-Avatar) für die Standorte ${c.locations}. Momentaufnahme vom ${c.date}.`,
      },
      {
        title: 'Metriken',
        body: () =>
          'Erwähnungsrate = Anteil der Antworten, die die Marke nennen. Zitationsrate = Anteil der Antworten, die die eigene Domain verlinken. Share of Voice = Anteil an allen Markennennungen. AI Visibility Index = 0.40 × Erwähnung + 0.35 × Zitation + 0.25 × SoV.',
      },
      {
        title: 'Grenzen',
        body: () =>
          'API-Antworten können von der eingeloggten Chat-Oberfläche abweichen (Personalisierung, Speicher, A/B-Tests). Jeder Lauf ist eine Ziehung aus einem probabilistischen Modell — Einzelwerte streuen, die Richtung ist belastbar. Alle Werte sind eine Momentaufnahme des Testzeitraums.',
      },
      {
        title: 'Modellierte Werte',
        body: (c) =>
          `Die Wirkungsrechnung (Seite «Roadmap») ist ein Modell: CHF ${chf(c.assumptions.projectValueChf)} Projektwert, ${chf(c.assumptions.queriesPerMonth)} Anfragen/Monat, ${Math.round(c.assumptions.ctrOther * 100)}% CTR, ${Math.round(c.assumptions.conversion * 100)}% Conversion. Sie ist als Grössenordnung zu lesen, nie als Messung.`,
      },
    ],
    contact: 'Future Media — info@future-media.ch · www.future-media.ch',
  },
  en: {
    dossier: 'AI VISIBILITY DOSSIER',
    confidential: 'CONFIDENTIAL',
    footerLeft: 'Future Media · LeadEngine — Confidential',
    generated: 'Generated',
    pageOf: (p, t) => `${String(p).padStart(2, '0')} / ${String(t).padStart(2, '0')}`,
    variantGeneral: 'Market Overview',
    variantAvatar: 'Avatar Lens',
    coverAudit: 'AI SEARCH AUDIT',
    liveTested: (d) => `LIVE-TESTED · ${d}`,
    indexLabel: 'AI VISIBILITY INDEX',
    of100: 'OF 100',
    verdictKicker: 'THE VERDICT',
    verdictBand: (i) =>
      i >= 65
        ? 'Leading the AI channel — now defend the lead.'
        : i >= 40
          ? 'Visible but contestable — the gaps are measurable.'
          : i >= 18
            ? 'Emerging — unanswered demand flows to competitors.'
            : 'Critically under-visible — AI search barely finds you.',
    verdictBody: (v) =>
      `Index ${v.index}/100: ${v.company} is mentioned in ${v.mention} of test runs ` +
      `but cited as a source in only ${v.citation}. The strongest competitor holds ` +
      `${v.topSov} share of voice — measured across ${v.engines} AI engines.`,
    formulaNote:
      'Index = 0.40 × mention rate + 0.35 × citation rate + 0.25 × share of voice. Computed exclusively from this audit\'s live test runs.',
    kMention: 'Mention rate',
    kCitation: 'Citation rate',
    kSov: 'Share of voice',
    kRank: 'Avg rank',
    kRuns: 'Test runs',
    kEngines: 'Engines',
    kMentionSub: 'answers naming you',
    kCitationSub: 'answers linking you',
    kSovSub: 'of all brand mentions',
    kRankSub: 'position when named',
    kRunsSub: 'successfully analyzed',
    kEnginesSub: 'queried live',
    mLocations: 'LOCATIONS',
    mPrompts: 'PROMPTS',
    mEngines: 'ENGINES',
    mVariant: 'PERSPECTIVE',
    tocTitle: 'CONTENTS',
    avatarKicker: 'YOUR AVATAR',
    avatarLede: (p) => `Every figure in this dossier is measured through the eyes of: ${p}`,
    p2Kicker: 'ENGINE ARENA',
    p2Title: 'The Engine Battlefield',
    p2Lede: 'Each engine is its own market — visibility does not carry over.',
    runsShort: 'runs',
    rankShort: 'Rank',
    heatTitle: 'Heat matrix — engine × metric',
    heatNote: 'Cell color is relative to the matrix maximum — the brighter, the stronger.',
    readingTitle: 'How to read this',
    p3Kicker: 'MARKET',
    p3Title: 'The Market Leaderboard',
    p3Lede: 'Share of AI mentions across all analyzed test runs.',
    threatKicker: 'TOP THREAT',
    threatBody: (v) =>
      `${v.name} dominates with ${v.topSov} share of voice — you hold ${v.sov}. Every unanswered query pays into their account.`,
    signalsTitle: 'Market signals',
    youSuffix: ' (you)',
    p4Kicker: 'DIAGNOSTIC',
    p4Title: 'The Three Gates of AI Visibility',
    p4Lede: 'A brand only wins if it passes all three gates in sequence.',
    gates: [
      {
        kicker: 'GATE 1 · FETCHABLE',
        title: 'Get found',
        note: 'Engines must load your own pages as sources. Measured: citations of your domain in the source mix.',
      },
      {
        kicker: 'GATE 2 · CHOSEN',
        title: 'Get named',
        note: 'The model must put you into the answer. Measured: mention rate across all test runs.',
      },
      {
        kicker: 'GATE 3 · EXTRACTABLE',
        title: 'Get cited',
        note: 'The answer must link to you — that is where the click happens. Measured: citation rate across all runs.',
      },
    ],
    statusPass: 'PASS',
    statusWarn: 'PARTIAL',
    statusFail: 'FAIL',
    gateExplainer:
      'Fetchable means the engines pull your domain when answering. Chosen means your name appears in the answer. Extractable means the answer links you as a source. Each gate filters — a brand that fails the third gets zero traffic even when it is named.',
    mixTitle: 'Citation mix — whom the engines trust',
    classOwn: 'Own domain',
    classDir: 'Directories',
    classEarned: 'Earned media',
    classOther: 'Other',
    weakKicker: 'WEAKEST GATE',
    weakSentence: (g, v) =>
      g === 0
        ? `Your own domain appears only ${v.own}× in the source mix — the engines answer your topics with other people's pages.`
        : g === 1
          ? `At a ${v.mention} mention rate you are simply absent from most answers — entity building is the first lever.`
          : `You get named (${v.mention}) but rarely linked (${v.citation}) — citable, machine-readable content is missing.`,
    p5Kicker: 'SOURCES',
    p5Title: 'The Citation Supply Chain',
    p5Lede: 'These domains feed the engines their answers on your topics.',
    supDomain: 'DOMAIN',
    supClass: 'CLASS',
    supCites: 'CITATIONS',
    supComp: 'COMPETITORS IN CONTEXT',
    supTopics: 'TOPICS',
    hubsTitle: 'Citation hubs — one placement, multiple wins',
    hubLine: (d, c, comps) => `${d} — ${c} citations · supplies: ${comps}`,
    gapKicker: 'VISIBILITY–CITATION GAP',
    gapBody: (v) =>
      `${v.mention} mention but only ${v.citation} citation: your brand lives on other people's pages. The engines know you — but the click lands elsewhere.`,
    p6Kicker: 'TOPICS',
    p6Title: 'Topic × Engine',
    p6Lede: 'Mention rate per topic cluster and engine — where you exist and where you do not.',
    clusterTitle: 'Topic clusters',
    runsLabel: (n) => `${n} runs`,
    shapesTitle: 'Answer shapes — which format earns citations',
    shapeHeaders: ['FORMAT', 'ANSWERS', 'AVG CHARS', 'AVG SOURCES', 'CITATION', 'MENTION'],
    prevalenceLine: (v) =>
      `Prevalence: lists ${v.lists}% · tables ${v.tables}% · numbers ${v.numbers}% · avg ${v.avgChars} chars — across ${v.answers} analyzed answers.`,
    p7Kicker: 'GEO & PERSONA',
    p7Title: 'Where — and for Whom — You Are Visible',
    ladderTitle: 'Geo ladder — mention rate by search radius',
    personaTitle: 'Persona split — who finds you',
    personaGeneral: 'General search',
    personaAvatar: 'Buyer avatar',
    personaGeneralSub: 'mention rate, generic prompts',
    personaAvatarSub: 'mention rate, avatar prompts',
    avatarNoteGeneral: 'The avatar edition of this dossier measures the same questions through your buyer avatar:',
    insightsTitle: 'Key insights',
    p8Kicker: 'TONE',
    p8Title: 'Sentiment & Narrative',
    p8Lede: 'How AI answers talk about you — when they talk about you.',
    pos: 'positive',
    neu: 'neutral',
    neg: 'negative',
    engPosTitle: 'Positive share by engine',
    posShare: 'positive',
    trendTitle: 'Trend — positive share across audit days',
    narrativeTitle: 'Narrative signals',
    p9Kicker: 'COMPETITION',
    p9Title: 'Competitor Teardown',
    p9Lede: 'The pages the engines cite for your competitors — and why.',
    citations: 'citations',
    words: 'words',
    chipFaq: 'FAQ',
    chipTable: 'Table',
    chipStats: 'Statistics',
    chipSchema: 'Schema',
    patternsTitle: 'Patterns of the winning pages',
    patSchema: (p) => `${p}% use JSON-LD schema markup`,
    patFaq: (p) => `${p}% carry a FAQ section`,
    patLong: (p) => `${p}% run 1,500+ words`,
    patTable: (p) => `${p}% deploy comparison tables`,
    patStats: (p) => `${p}% cite statistics or prices`,
    patFormat: (f, p) => `${p}% bet on the '${f}' format`,
    p10Kicker: 'EVIDENCE',
    p10Title: 'The Evidence Log',
    p10Lede: 'Verbatim exhibits. Source dots: green = verified, cites you · red = fetched, does not · gray = unverified.',
    evCited: 'CITED',
    evMentioned: 'MENTIONED',
    evInvisible: 'INVISIBLE',
    evSources: 'Sources',
    p11Kicker: 'ROADMAP',
    p11Title: 'Roadmap & Modeled Impact',
    prio: ['P1 · NOW (0–30 DAYS)', 'P2 · BUILD (30–90 DAYS)', 'P3 · SCALE (90+ DAYS)'],
    impactTitle: 'Modeled impact — not measured',
    impClicks: 'Diverted clicks',
    impLeads: 'Lost inquiries',
    impChf: 'Foregone value',
    impClicksSub: 'per month, modeled',
    impLeadsSub: 'per month, modeled',
    impChfSub: 'CHF per month, modeled',
    impCompNote: (l, c) => `Of which competitors currently capture ~${l} inquiries (~CHF ${c}) per month.`,
    impAssumptions: (v) =>
      `Model assumptions: CHF ${v.value} project value · ${v.queries} AI queries/month · ${v.ctr} CTR · ${v.conv} conversion. Modeled figures, not measurements.`,
    closerKicker: 'VERDICT',
    p12Kicker: 'METHODOLOGY',
    p12Title: 'Methodology & Limits',
    meth: [
      {
        title: 'Engines & models',
        body: (c) =>
          `${c.engines} were queried live via their official APIs. ${c.runs} test runs were analyzed successfully; failed runs feed no metric.`,
      },
      {
        title: 'Sampling',
        body: (c) =>
          `${c.prompts} geo-tiered prompts (city › region › canton › German-speaking CH › Switzerland) in two personas (general / buyer avatar) for ${c.locations}. Snapshot taken ${c.date}.`,
      },
      {
        title: 'Metrics',
        body: () =>
          'Mention rate = share of answers naming the brand. Citation rate = share of answers linking the own domain. Share of voice = share of all brand mentions. AI Visibility Index = 0.40 × mention + 0.35 × citation + 0.25 × SoV.',
      },
      {
        title: 'Limits',
        body: () =>
          'API answers can diverge from the logged-in chat UI (personalization, memory, A/B tests). Each run is one draw from a probabilistic model — individual values scatter, the direction is robust. All figures are a snapshot of the test window.',
      },
      {
        title: 'Modeled figures',
        body: (c) =>
          `The impact math (Roadmap page) is a model: CHF ${chf(c.assumptions.projectValueChf)} project value, ${chf(c.assumptions.queriesPerMonth)} queries/month, ${Math.round(c.assumptions.ctrOther * 100)}% CTR, ${Math.round(c.assumptions.conversion * 100)}% conversion. Read it as an order of magnitude, never as a measurement.`,
      },
    ],
    contact: 'Future Media — info@future-media.ch · www.future-media.ch',
  },
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

/** Percent formatter — real measured values only. Suspicious values are
 * clamped and flagged so they get double-checked instead of silently shipped. */
function pct(v: number): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    console.warn(`[report] SUS pct value: ${v} — clamped, verify audit data`)
    return `${Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 100).toFixed(1)}%`
  }
  return `${n.toFixed(1)}%`
}

/** Swiss thousands separator: 150000 -> "150'000". */
function chf(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

function fmtDate(lang: ReportLang, d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  if (lang === 'de') return `${dd}.${mm}.${d.getFullYear()}`
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`
}

/** Strip **emphasis** markers coming from the narrative layer. */
function clean(line: string): string {
  return line.replace(/\*\*/g, '').trim()
}

/** Hostname of a URL, www stripped (display helper). */
function hostOf(url: string): string {
  return domainOf(url)
}

// ─── Deck input ─────────────────────────────────────────────────────────────

export interface DeckInput {
  lang: ReportLang
  company: Company
  /** Audit records for THIS scope (ok-flag filtered inside). */
  records: AuditRecord[]
  score: AuditScore
  impact: ImpactModel
  sections: ReportSections
  /** brand name -> regex source (built by pdf.ts from competitors + hints). */
  brands: Record<string, string>
  /** Evidence layer output — drives the supply-chain, topic-matrix and
   * evidence-log pages. Pages are skipped when absent/empty. */
  evidence?: ReportEvidence
  /** Sentiment breakdown/trend — drives the sentiment page when present. */
  sentiment?: SentimentReport
  /** Scraped competitor pages — drive the teardown page when non-empty. */
  competitorPages?: CompetitorPage[]
  /** Report family this deck renders: 'general' (market overview) or
   * 'avatar' (target-audience lens). Labels the cover + running header. */
  variant?: string
}

// ─── Derived metrics (computed once, shared by all pages) ───────────────────

interface Ctx {
  doc: Doc
  s: Str
  lang: ReportLang
  input: DeckInput
  company: Company
  variant: 'general' | 'avatar'
  variantLabel: string
  today: string
  engs: Engine[]
  okRecs: AuditRecord[]
  index: number
  promptCount: number
  ranked: Array<{ name: string; count: number; share: number; isClient: boolean }>
  rankPos: number
  topComp: string
  engStat: (e: Engine) => EngineStats
  geo: Array<{ label: string; value: number }>
  personaGeneral: number
  personaAvatar: number
  citeTotal: number
  /** Filled by renderDeck once the page plan is known — cover contents list. */
  toc: Array<{ no: number; title: string }>
}

function buildCtx(doc: Doc, input: DeckInput): Ctx {
  const { lang, company, records, score, brands } = input
  const s = S[lang]
  const overall = score.overall
  const clientRx = new RegExp(clientPattern(company), 'i')
  const activeEngs = ENGS.filter((e) => records.some((r) => r.engine === e && r.ok))
  const engs = activeEngs.length > 0 ? activeEngs : ENGS.slice(0, 1)
  const okRecs = records.filter((r) => r.ok && r.text !== undefined && engs.includes(r.engine))

  // Leaderboard: share of mentions per brand across ok runs
  const counts: Record<string, number> = {}
  for (const [b, rxSrc] of Object.entries(brands)) {
    const rx = new RegExp(rxSrc, 'i')
    counts[b] = okRecs.filter((r) => rx.test(r.text ?? '')).length
  }
  counts[company.name] = okRecs.filter((r) => clientRx.test(r.text ?? '')).length
  const total = Object.values(counts).reduce((a, v) => a + v, 0) || 1
  const ranked = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({
      name,
      count,
      share: Math.round((1000 * count) / total) / 10,
      isClient: name === company.name,
    }))
  const rankPos = Math.max(ranked.findIndex((r) => r.isClient) + 1, 1)
  const topComp = ranked.find((r) => !r.isClient)?.name ?? '—'

  const index = Math.round(
    Math.min(Math.max(0.4 * overall.mentionRate + 0.35 * overall.citationRate + 0.25 * overall.sov, 0), 100),
  )

  const variant: 'general' | 'avatar' = input.variant === 'avatar' ? 'avatar' : 'general'
  const citeTotal = Object.values(score.citationClasses).reduce((a, v) => a + v, 0)

  return {
    doc,
    s,
    lang,
    input,
    company,
    variant,
    variantLabel: variant === 'avatar' ? s.variantAvatar : s.variantGeneral,
    today: fmtDate(lang),
    engs,
    okRecs,
    index,
    promptCount: new Set(records.map((r) => r.prompt)).size,
    ranked,
    rankPos,
    topComp,
    engStat: (e) =>
      score.perEngine[e] ?? {
        runsOk: 0,
        mentionRate: 0,
        citationRate: 0,
        sov: 0,
        avgRank: null,
        sentimentPosPct: null,
      },
    geo: GEO_ORDER.map((g) => ({
      label: GEO_LABEL[lang][g],
      value: tierMention(records, 'tier', g, company),
    })),
    personaGeneral: tierMention(records, 'persona', 'general', company),
    personaAvatar: tierMention(records, 'persona', 'avatar', company),
    citeTotal,
    toc: [],
  }
}

// ─── Text helpers (width-true clipping) ─────────────────────────────────────

/** Truncate `text` so it fits `width` at the CURRENT font/size, '…' suffix. */
function fit(doc: Doc, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text
  let t = text
  while (t.length > 1 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** Wrapped paragraph capped at `maxLines`; returns the y below the text. */
function para(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
  maxLines = 3,
  font = 'Helvetica',
): number {
  doc.font(font).fontSize(size).fillColor(color)
  const lineH = size * 1.32
  const maxH = maxLines * lineH + 1
  const h = Math.min(doc.heightOfString(text, { width, lineGap: size * 0.32 }), maxH)
  doc.text(text, x, y, { width, height: maxH, ellipsis: true, lineGap: size * 0.32 })
  return y + h
}

/** Square-marker bullet, max 2 wrapped lines. Returns the y below. */
function bullet(doc: Doc, x: number, y: number, w: number, text: string): number {
  doc.rect(x + 0.5, y + 2.6, 2.6, 2.6).fill(THEME.PURPLE)
  return para(doc, clean(text), x + 6 * MM, y, w - 6 * MM, 8.5, THEME.WHITE, 2) + 2.6 * MM
}

// ─── Page chrome ────────────────────────────────────────────────────────────

function paintBg(doc: Doc): void {
  doc.rect(0, 0, W, H).fill(THEME.BG)
}

function logo(doc: Doc, x: number, yTop: number, w: number): void {
  if (fs.existsSync(LOGO)) {
    doc.image(LOGO, x, yTop, { width: w, height: w / LOGO_RATIO })
  } else {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(THEME.WHITE).text('FUTURE MEDIA', x, yTop, { lineBreak: false })
  }
}

/** Standard header: logo, running meta, rule, numbered kicker, title, lede.
 * Returns the content start y. */
function header(ctx: Ctx, pageNo: number, kicker: string, title: string, lede?: string): number {
  const { doc, s, company } = ctx
  logo(doc, M, 9 * MM, 20 * MM)
  doc
    .font('Helvetica')
    .fontSize(6.3)
    .fillColor(THEME.GRAY)
    .text(`${s.dossier} — ${company.name.toUpperCase()} · ${ctx.variantLabel.toUpperCase()}`, M, 10.6 * MM, {
      width: CW,
      align: 'right',
      lineBreak: false,
      characterSpacing: 0.5,
    })
  doc.save().lineWidth(0.5).moveTo(M, 15.5 * MM).lineTo(W - M, 15.5 * MM).stroke(THEME.FAINT).restore()
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(THEME.PURPLE)
    .text(`${String(pageNo).padStart(2, '0')} — ${kicker}`, M, 20 * MM, {
      lineBreak: false,
      characterSpacing: 1.4,
    })
  doc.font('Helvetica-Bold').fontSize(18).fillColor(THEME.WHITE).text(title, M, 24.5 * MM, { lineBreak: false })
  if (lede) {
    doc.font('Helvetica').fontSize(9).fillColor(THEME.LIGHT)
    doc.text(fit(doc, lede, CW), M, 33.5 * MM, { lineBreak: false })
    return 41 * MM
  }
  return 36 * MM
}

/** Footer: rule, imprint + generation date left, page counter right. */
function footer(ctx: Ctx, pageNo: number, totalPages: number): void {
  const { doc, s } = ctx
  const fy = H - 13 * MM
  doc.save().lineWidth(0.5).moveTo(M, fy).lineTo(W - M, fy).stroke(THEME.FAINT).restore()
  doc
    .font('Helvetica')
    .fontSize(6.3)
    .fillColor(THEME.GRAY)
    .text(`${s.footerLeft} · ${s.generated} ${ctx.today}`, M, fy + 2.5 * MM, { lineBreak: false })
  doc
    .font('Helvetica-Bold')
    .fontSize(6.3)
    .fillColor(THEME.LIGHT)
    .text(s.pageOf(pageNo, totalPages), M, fy + 2.5 * MM, { width: CW, align: 'right', lineBreak: false })
}

// ─── P1 Cover ───────────────────────────────────────────────────────────────

function pageCover(ctx: Ctx): void {
  const { doc, s, company, input } = ctx
  const overall = input.score.overall

  logo(doc, M, 15 * MM, 40 * MM)
  // confidential chip, right-aligned
  doc.font('Helvetica-Bold').fontSize(6.5)
  const confW = doc.widthOfString(s.confidential) + 11
  chip(doc, W - M - confW, 15.5 * MM, s.confidential, { color: THEME.LIGHT, bold: true })

  // kicker badge line
  let bx = M
  const by = 45 * MM
  bx += chip(doc, bx, by, s.coverAudit, { color: THEME.LIGHT, bold: true }) + 6
  bx += chip(doc, bx, by, s.liveTested(ctx.today), { color: THEME.LIGHT }) + 6
  chip(doc, bx, by, ctx.variantLabel.toUpperCase(), { color: THEME.PURPLE, bold: true, dot: true })

  // company identity
  doc.font('Helvetica-Bold').fontSize(33).fillColor(THEME.WHITE)
  doc.text(fit(doc, company.name, CW), M, 55 * MM, { lineBreak: false })
  doc.font('Helvetica').fontSize(10.5).fillColor(THEME.LIGHT)
  doc.text(fit(doc, `${company.sector} · ${company.location}`, CW), M, 69.5 * MM, { lineBreak: false })
  doc.save().lineWidth(0.5).moveTo(M, 78 * MM).lineTo(W - M, 78 * MM).stroke(THEME.FAINT).restore()

  // hero: ring gauge left, verdict right
  const gx = M + 27 * MM
  const gy = 111 * MM
  ringGauge(doc, gx, gy, 23 * MM, ctx.index, THEME.PURPLE, 8)
  doc
    .font('Helvetica-Bold')
    .fontSize(34)
    .fillColor(THEME.WHITE)
    .text(String(ctx.index), gx - 20 * MM, gy - 7 * MM, { width: 40 * MM, align: 'center', lineBreak: false })
  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor(THEME.LIGHT)
    .text(s.of100, gx - 20 * MM, gy + 6 * MM, {
      width: 40 * MM,
      align: 'center',
      lineBreak: false,
      characterSpacing: 1,
    })
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(THEME.PURPLE)
    .text(s.indexLabel, gx - 30 * MM, gy + 28 * MM, {
      width: 60 * MM,
      align: 'center',
      lineBreak: false,
      characterSpacing: 1.2,
    })

  const vx = M + 64 * MM
  const vw = CW - 64 * MM
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(THEME.PURPLE)
    .text(s.verdictKicker, vx, 88 * MM, { lineBreak: false, characterSpacing: 1.4 })
  para(doc, s.verdictBand(ctx.index), vx, 93.5 * MM, vw, 15.5, THEME.LAVENDER, 2, 'Helvetica-Bold')
  para(
    doc,
    s.verdictBody({
      index: ctx.index,
      company: company.name,
      mention: pct(overall.mentionRate),
      citation: pct(overall.citationRate),
      topSov: pct(overall.topCompetitorSov),
      engines: ctx.engs.length,
    }),
    vx,
    112 * MM,
    vw,
    9,
    THEME.LIGHT,
    4,
  )
  para(doc, s.formulaNote, vx, 130 * MM, vw, 6, THEME.GRAY, 2)

  // KPI wall — 6 tiles, 3 × 2
  const tw = (CW - 8 * MM) / 3
  const th = 24 * MM
  const rows: Array<[string, string, string, string]> = [
    [s.kMention, pct(overall.mentionRate), s.kMentionSub, THEME.PURPLE],
    [s.kCitation, pct(overall.citationRate), s.kCitationSub, THEME.BLUE],
    [s.kSov, pct(overall.sov), s.kSovSub, THEME.LAVENDER],
    [s.kRank, overall.avgRank === null ? '—' : `#${overall.avgRank.toFixed(1)}`, s.kRankSub, THEME.GREEN],
    [s.kRuns, String(overall.runsOk), s.kRunsSub, THEME.BLUE],
    [s.kEngines, String(ctx.engs.length), s.kEnginesSub, THEME.PURPLE],
  ]
  rows.forEach(([label, value, sub, accent], i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    statTile(doc, M + col * (tw + 4 * MM), 149 * MM + row * (th + 4 * MM), tw, th, {
      label,
      value,
      sub,
      accent,
    })
  })

  // metadata strip — weighted columns so the engine list never truncates
  const my = 206 * MM
  doc.roundedRect(M, my, CW, 22 * MM, 5).fill(THEME.CARD)
  const cols: Array<[string, string, number]> = [
    [s.mLocations, company.locations.length > 0 ? company.locations.join(', ') : company.location, 0.24],
    [s.mPrompts, String(ctx.promptCount), 0.1],
    [s.mEngines, ctx.engs.map((e) => ENG_LABEL[e]).join(' · '), 0.4],
    [s.mVariant, ctx.variantLabel, 0.26],
  ]
  const innerW = CW - 16 * MM
  let cx = M + 8 * MM
  cols.forEach(([label, value, frac], i) => {
    const colW = innerW * frac
    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor(THEME.GRAY)
      .text(label, cx, my + 5.5 * MM, { lineBreak: false, characterSpacing: 0.8 })
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(THEME.WHITE)
    doc.text(fit(doc, value, colW - 6 * MM), cx, my + 10.5 * MM, { lineBreak: false })
    if (i > 0) {
      doc
        .save()
        .lineWidth(0.5)
        .moveTo(cx - 4 * MM, my + 4.5 * MM)
        .lineTo(cx - 4 * MM, my + 17.5 * MM)
        .stroke(THEME.FAINT)
        .restore()
    }
    cx += colW
  })

  // avatar lens: the audited persona, spelled out
  let ty = 238 * MM
  if (ctx.variant === 'avatar' && company.buyerPersona) {
    const ay = 232.5 * MM
    doc.rect(M, ay, 2.2, 9 * MM).fill(THEME.PURPLE)
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(THEME.PURPLE)
      .text(s.avatarKicker, M + 6, ay - 0.5, { lineBreak: false, characterSpacing: 1.2 })
    para(doc, s.avatarLede(company.buyerPersona), M + 6, ay + 3.6 * MM, CW - 6, 8, THEME.LIGHT, 2)
    ty = 247 * MM
  }

  // contents — two-column micro list built from the actual page plan
  if (ctx.toc.length > 0) {
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(THEME.LIGHT)
      .text(s.tocTitle, M, ty, { lineBreak: false, characterSpacing: 1.4 })
    const entries = ctx.toc
    const perCol = Math.ceil(entries.length / 2)
    const colWidth = (CW - 10 * MM) / 2
    const rowH = 5.2 * MM
    entries.forEach((e, i) => {
      const col = Math.floor(i / perCol)
      const ex = M + col * (colWidth + 10 * MM)
      const ey = ty + 5.5 * MM + (i % perCol) * rowH
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(THEME.PURPLE)
        .text(String(e.no).padStart(2, '0'), ex, ey, { lineBreak: false })
      doc.font('Helvetica').fontSize(7.5).fillColor(THEME.LIGHT)
      doc.text(fit(doc, e.title, colWidth - 8 * MM), ex + 6 * MM, ey - 0.5, { lineBreak: false })
    })
  }
}

// ─── P2 Engine battlefield ──────────────────────────────────────────────────

function pageEngines(ctx: Ctx, pageNo: number): void {
  const { doc, s, input } = ctx
  const overall = input.score.overall
  let y = header(ctx, pageNo, s.p2Kicker, s.p2Title, s.p2Lede)

  const cw = (CW - 4 * MM) / 2
  const ch = 32 * MM
  ctx.engs.forEach((e, i) => {
    const es = ctx.engStat(e)
    const x = M + (i % 2) * (cw + 4 * MM)
    const cy = y + Math.floor(i / 2) * (ch + 4 * MM)
    doc.roundedRect(x, cy, cw, ch, 5).fill(THEME.CARD)
    const pad = 4.5 * MM
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(THEME.LAVENDER)
      .text(ENG_LABEL[e], x + pad, cy + pad - 1, { lineBreak: false })
    doc.font('Helvetica').fontSize(6.5)
    const runsTxt = `${es.runsOk} ${s.runsShort}`
    doc
      .fillColor(THEME.GRAY)
      .text(runsTxt, x + cw - pad - doc.widthOfString(runsTxt), cy + pad + 1, { lineBreak: false })
    // headline metric: mention rate + delta vs deck average
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(THEME.WHITE)
      .text(pct(es.mentionRate), x + pad, cy + 10.5 * MM, { lineBreak: false })
    doc
      .font('Helvetica')
      .fontSize(6.3)
      .fillColor(THEME.LIGHT)
      .text(s.kMention.toUpperCase(), x + pad, cy + 17.5 * MM, { lineBreak: false, characterSpacing: 0.6 })
    deltaChip(doc, x + pad + 34 * MM, cy + 11.5 * MM, es.mentionRate - overall.mentionRate)
    // secondary metrics row
    const mets: Array<[string, string]> = [
      [s.kCitation, pct(es.citationRate)],
      [s.kSov, pct(es.sov)],
      [s.rankShort, es.avgRank === null ? '—' : `#${es.avgRank.toFixed(1)}`],
    ]
    const mw = (cw - 2 * pad) / 3
    mets.forEach(([label, value], j) => {
      const mx = x + pad + j * mw
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(THEME.WHITE)
        .text(value, mx, cy + ch - 10.5 * MM, { lineBreak: false })
      doc.font('Helvetica').fontSize(5.8).fillColor(THEME.GRAY)
      doc.text(fit(doc, label.toUpperCase(), mw - 4), mx, cy + ch - 6 * MM, {
        lineBreak: false,
        characterSpacing: 0.4,
      })
    })
  })
  y += Math.ceil(ctx.engs.length / 2) * (ch + 4 * MM) + 5 * MM

  // heat matrix engine × metric
  y = sectionHead(doc, M, y, CW, s.heatTitle)
  y = heatMatrix(doc, M, y, CW, {
    rowLabels: ctx.engs.map((e) => ENG_LABEL[e]),
    colLabels: [s.kMention, s.kCitation, s.kSov],
    values: ctx.engs.map((e) => {
      const es = ctx.engStat(e)
      return [es.mentionRate, es.citationRate, es.sov]
    }),
    labelW: 36 * MM,
  })
  doc.font('Helvetica').fontSize(6.5).fillColor(THEME.GRAY)
  doc.text(fit(doc, s.heatNote, CW), M, y + 2 * MM, { lineBreak: false })
  y += 10 * MM

  // reading pulls
  const pulls = (input.sections.ANALYSIS.length > 0 ? input.sections.ANALYSIS : input.sections.KEY_INSIGHTS).slice(0, 3)
  if (pulls.length > 0) {
    y = sectionHead(doc, M, y, CW, s.readingTitle)
    for (const line of pulls) y = bullet(doc, M, y, CW, line)
  }
}

// ─── P3 Market leaderboard ──────────────────────────────────────────────────

function pageLeaderboard(ctx: Ctx, pageNo: number): void {
  const { doc, s, input } = ctx
  const overall = input.score.overall
  let y = header(ctx, pageNo, s.p3Kicker, s.p3Title, s.p3Lede)

  // top 8 rows, client guaranteed present
  let rows = ctx.ranked.slice(0, 8)
  if (!rows.some((r) => r.isClient)) {
    const client = ctx.ranked.find((r) => r.isClient)
    if (client) rows = [...ctx.ranked.slice(0, 7), client]
  }
  const rankRows: RankedRow[] = rows.map((r) => {
    doc.font(r.isClient ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
    return {
      name: fit(doc, r.isClient ? `${r.name}${s.youSuffix}` : r.name, 49 * MM),
      value: r.share,
      display: `${r.share.toFixed(1)}%`,
      highlight: r.isClient,
    }
  })
  y = rankedBars(doc, M, y, CW, rankRows) + 6 * MM

  // top-threat callout
  if (ctx.topComp !== '—') {
    const cy = y
    doc.roundedRect(M, cy, CW, 27 * MM, 5).fill(THEME.CARD)
    doc.save().roundedRect(M, cy, CW, 27 * MM, 5).clip()
    doc.rect(M, cy, 2.4, 27 * MM).fill(THEME.RED)
    doc.restore()
    const pad = 6 * MM
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(THEME.RED)
      .text(s.threatKicker, M + pad, cy + 4.5 * MM, { lineBreak: false, characterSpacing: 1.2 })
    doc.font('Helvetica-Bold').fontSize(13).fillColor(THEME.WHITE)
    doc.text(fit(doc, ctx.topComp, CW - 2 * pad - 60 * MM), M + pad, cy + 9.5 * MM, { lineBreak: false })
    deltaChip(doc, W - M - pad - 60, cy + 5 * MM, overall.sov - overall.topCompetitorSov)
    para(
      doc,
      s.threatBody({ name: ctx.topComp, topSov: pct(overall.topCompetitorSov), sov: pct(overall.sov) }),
      M + pad,
      cy + 16.5 * MM,
      CW - 2 * pad,
      8,
      THEME.LIGHT,
      2,
    )
    y += 33 * MM
  }

  const pulls = input.sections.MARKET.slice(0, 3)
  if (pulls.length > 0) {
    y = sectionHead(doc, M, y, CW, s.signalsTitle)
    for (const line of pulls) y = bullet(doc, M, y, CW, line)
  }
}

// ─── P4 Three Gates ─────────────────────────────────────────────────────────

function gateStatuses(ctx: Ctx): [GateStatus, GateStatus, GateStatus] {
  const overall = ctx.input.score.overall
  const own = ctx.input.score.citationClasses.own
  const ownShare = ctx.citeTotal > 0 ? (100 * own) / ctx.citeTotal : 0
  const g1: GateStatus = own > 0 && ownShare >= 10 ? 'pass' : own > 0 ? 'warn' : 'fail'
  const g2: GateStatus = overall.mentionRate >= 40 ? 'pass' : overall.mentionRate >= 15 ? 'warn' : 'fail'
  const g3: GateStatus = overall.citationRate >= 20 ? 'pass' : overall.citationRate >= 5 ? 'warn' : 'fail'
  return [g1, g2, g3]
}

function pageGates(ctx: Ctx, pageNo: number): void {
  const { doc, s, input } = ctx
  const overall = input.score.overall
  const classes = input.score.citationClasses
  let y = header(ctx, pageNo, s.p4Kicker, s.p4Title, s.p4Lede)

  const statuses = gateStatuses(ctx)
  const statusLabel = (st: GateStatus) =>
    st === 'pass' ? s.statusPass : st === 'warn' ? s.statusWarn : s.statusFail
  const ownShare = ctx.citeTotal > 0 ? Math.round((100 * classes.own) / ctx.citeTotal) : 0
  const values = [
    `${classes.own} (${ownShare}%)`,
    pct(overall.mentionRate),
    pct(overall.citationRate),
  ]
  const nodes: PipelineNode[] = s.gates.map((g, i) => ({
    kicker: g.kicker,
    title: g.title,
    value: values[i] ?? '—',
    status: statuses[i] ?? 'fail',
    statusLabel: statusLabel(statuses[i] ?? 'fail'),
    note: g.note,
  }))
  y = pipeline(doc, M, y, CW, nodes, 47 * MM) + 6 * MM

  y = para(doc, s.gateExplainer, M, y, CW, 8.5, THEME.LIGHT, 4) + 6 * MM

  // citation mix band
  if (ctx.citeTotal > 0) {
    y = sectionHead(doc, M, y, CW, s.mixTitle)
    y = segmentedBand(
      doc,
      M,
      y + 1 * MM,
      CW,
      7 * MM,
      [
        { label: s.classOwn, value: classes.own, color: THEME.GREEN },
        { label: s.classDir, value: classes.directories, color: THEME.BLUE },
        { label: s.classEarned, value: classes.earned, color: THEME.PURPLE },
        { label: s.classOther, value: classes.other, color: THEME.GRAY },
      ],
      true,
    ) + 4 * MM
  }

  // weakest gate takeaway
  const norm = [
    ctx.citeTotal > 0 ? (100 * classes.own) / ctx.citeTotal / 0.25 : 0, // own share vs 25% target
    overall.mentionRate / 40,
    overall.citationRate / 20,
  ]
  let weakest: 0 | 1 | 2 = 0
  if ((norm[1] ?? 0) < (norm[weakest] ?? 0)) weakest = 1
  if ((norm[2] ?? 0) < (norm[weakest] ?? 0)) weakest = 2
  const wCol = GATE_COLOR[statuses[weakest] ?? 'fail']
  doc.roundedRect(M, y, CW, 20 * MM, 5).fill(THEME.CARD)
  doc.save().roundedRect(M, y, CW, 20 * MM, 5).clip()
  doc.rect(M, y, 2.4, 20 * MM).fill(wCol)
  doc.restore()
  doc
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor(wCol)
    .text(`${s.weakKicker} — ${s.gates[weakest].kicker}`, M + 6 * MM, y + 4 * MM, {
      lineBreak: false,
      characterSpacing: 1.1,
    })
  para(
    doc,
    s.weakSentence(weakest, {
      own: classes.own,
      mention: pct(overall.mentionRate),
      citation: pct(overall.citationRate),
    }),
    M + 6 * MM,
    y + 8.5 * MM,
    CW - 12 * MM,
    9,
    THEME.WHITE,
    2,
  )
}

// ─── P5 Citation supply chain ───────────────────────────────────────────────

type DomainClass = 'own' | 'directories' | 'earned' | 'other'

function classifyDomain(domain: string, isOwn: boolean): DomainClass {
  if (isOwn) return 'own'
  if (DIRECTORY_DOMAINS.some((d) => domain.includes(d))) return 'directories'
  if (EARNED_HINTS.some((e) => domain.includes(e))) return 'earned'
  return 'other'
}

const CLASS_COLOR: Record<DomainClass, string> = {
  own: THEME.GREEN,
  directories: THEME.BLUE,
  earned: THEME.PURPLE,
  other: THEME.GRAY,
}

function pageSupplyChain(ctx: Ctx, pageNo: number): void {
  const { doc, s, lang, input } = ctx
  const evidence = input.evidence as ReportEvidence
  const overall = input.score.overall
  let y = header(ctx, pageNo, s.p5Kicker, s.p5Title, s.p5Lede)

  const classLabel: Record<DomainClass, string> = {
    own: s.classOwn,
    directories: s.classDir,
    earned: s.classEarned,
    other: s.classOther,
  }

  // ranked domain table
  const domains = evidence.supplyChain.domains.slice(0, 10)
  const maxCites = Math.max(...domains.map((d) => d.citations), 1)
  // columns: # 8 | domain 46 | class 26 | citations 38 | competitors 40 | topics 16 (mm)
  const cx = [M, M + 8 * MM, M + 54 * MM, M + 80 * MM, M + 118 * MM, M + 158 * MM]
  doc.font('Helvetica').fontSize(6).fillColor(THEME.GRAY)
  const headers = ['#', s.supDomain, s.supClass, s.supCites, s.supComp, s.supTopics]
  headers.forEach((h, i) => {
    doc.text(h, cx[i] ?? M, y, { lineBreak: false, characterSpacing: 0.6 })
  })
  y += 4.5 * MM
  doc.save().lineWidth(0.5).moveTo(M, y - 1 * MM).lineTo(W - M, y - 1 * MM).stroke(THEME.FAINT).restore()
  const rowH = 8.6 * MM
  domains.forEach((d, i) => {
    const mid = y + rowH / 2 - 4
    const cls = classifyDomain(d.domain, d.isOwn)
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(THEME.GRAY)
      .text(String(i + 1), cx[0] ?? M, mid, { lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(d.isOwn ? THEME.GREEN : THEME.WHITE)
    doc.text(fit(doc, d.domain, 43 * MM), cx[1] ?? M, mid, { lineBreak: false })
    chip(doc, cx[2] ?? M, y + rowH / 2 - 6, classLabel[cls], { color: CLASS_COLOR[cls], dot: true, size: 5.8 })
    // citation bar + count
    const barW = 24 * MM
    doc.roundedRect(cx[3] ?? M, y + rowH / 2 - 1.4 * MM, barW, 2.8 * MM, 1.4 * MM).fill(THEME.CARD)
    doc
      .roundedRect(cx[3] ?? M, y + rowH / 2 - 1.4 * MM, Math.max((barW * d.citations) / maxCites, 2), 2.8 * MM, 1.4 * MM)
      .fill(CLASS_COLOR[cls])
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(THEME.WHITE)
      .text(String(d.citations), (cx[3] ?? M) + barW + 2 * MM, mid, { lineBreak: false })
    doc.font('Helvetica').fontSize(7.5).fillColor(THEME.LIGHT)
    doc.text(fit(doc, d.competitors.slice(0, 3).join(', ') || '—', 37 * MM), cx[4] ?? M, mid, { lineBreak: false })
    doc.font('Helvetica').fontSize(7.5).fillColor(THEME.GRAY)
    doc.text(
      fit(doc, d.topics.map((t) => TOPIC_LABEL[lang][t].split(' ')[0] ?? '').join(', '), 16 * MM),
      cx[5] ?? M,
      mid,
      { lineBreak: false },
    )
    if (i < domains.length - 1) {
      doc
        .save()
        .lineWidth(0.4)
        .opacity(0.5)
        .moveTo(M, y + rowH)
        .lineTo(W - M, y + rowH)
        .stroke(THEME.FAINT)
        .restore()
    }
    y += rowH
  })
  y += 6 * MM

  // citation hubs
  const hubs = evidence.supplyChain.hubs.slice(0, 3)
  if (hubs.length > 0) {
    y = sectionHead(doc, M, y, CW, s.hubsTitle, THEME.BLUE)
    for (const hub of hubs) {
      doc.circle(M + 2, y + 3.6, 2).fill(THEME.BLUE)
      doc.font('Helvetica').fontSize(8.5).fillColor(THEME.WHITE)
      doc.text(
        fit(doc, s.hubLine(hub.domain, hub.citations, hub.competitors.slice(0, 3).join(', ')), CW - 6 * MM),
        M + 6 * MM,
        y + 0.5,
        { lineBreak: false },
      )
      y += 7 * MM
    }
    y += 3 * MM
  }

  // visibility–citation gap banner
  const gap = overall.mentionRate - overall.citationRate
  if (gap >= 15 && overall.mentionRate >= 2 * Math.max(overall.citationRate, 0.1)) {
    doc.roundedRect(M, y, CW, 20 * MM, 5).fill(THEME.CARD)
    doc.save().roundedRect(M, y, CW, 20 * MM, 5).clip()
    doc.rect(M, y, 2.4, 20 * MM).fill(THEME.RED)
    doc.restore()
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(THEME.RED)
      .text(s.gapKicker, M + 6 * MM, y + 4 * MM, { lineBreak: false, characterSpacing: 1.1 })
    para(
      doc,
      s.gapBody({ mention: pct(overall.mentionRate), citation: pct(overall.citationRate) }),
      M + 6 * MM,
      y + 8.5 * MM,
      CW - 12 * MM,
      9,
      THEME.WHITE,
      2,
    )
    y += 26 * MM
  } else {
    const pulls = input.sections.CITATIONS.slice(0, 2)
    if (pulls.length > 0) {
      y = sectionHead(doc, M, y, CW, s.readingTitle)
      for (const line of pulls) y = bullet(doc, M, y, CW, line)
    }
  }
}

// ─── P6 Topic × engine ──────────────────────────────────────────────────────

function pageTopics(ctx: Ctx, pageNo: number): void {
  const { doc, s, lang, input } = ctx
  const evidence = input.evidence as ReportEvidence
  const bundle = evidence.bundle
  let y = header(ctx, pageNo, s.p6Kicker, s.p6Title, s.p6Lede)

  const topics = bundle.topics.slice(0, 5)
  // heat matrix topic × engine
  y = heatMatrix(doc, M, y, CW, {
    rowLabels: topics.map((t) => TOPIC_LABEL[lang][t.topic]),
    colLabels: ctx.engs.map((e) => ENG_LABEL[e]),
    values: topics.map((t) => ctx.engs.map((e) => bundle.visibilityMatrix[t.topic]?.[e] ?? null)),
    labelW: 38 * MM,
    cellH: 8.5 * MM,
  })
  y += 6 * MM

  // topic cluster cards
  y = sectionHead(doc, M, y, CW, s.clusterTitle)
  const tw = (CW - 8 * MM) / 3
  const th = 19 * MM
  topics.forEach((t, i) => {
    const x = M + (i % 3) * (tw + 4 * MM)
    const cy = y + Math.floor(i / 3) * (th + 4 * MM)
    doc.roundedRect(x, cy, tw, th, 4).fill(THEME.CARD)
    const pad = 4 * MM
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(THEME.WHITE)
    doc.text(fit(doc, TOPIC_LABEL[lang][t.topic], tw - 2 * pad - 14 * MM), x + pad, cy + pad - 1, { lineBreak: false })
    doc.font('Helvetica').fontSize(6)
    const rl = s.runsLabel(t.runsOk)
    doc
      .fillColor(THEME.GRAY)
      .text(rl, x + tw - pad - doc.widthOfString(rl), cy + pad + 0.5, { lineBreak: false })
    const stats: Array<[string, string, string]> = [
      [s.kMention, pct(t.mentionRate), THEME.PURPLE],
      [s.kCitation, pct(t.citationRate), THEME.BLUE],
    ]
    stats.forEach(([label, value, color], j) => {
      const sx = x + pad + j * ((tw - 2 * pad) / 2)
      doc.circle(sx + 1.5, cy + 11 * MM + 1.5, 1.5).fill(color)
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(THEME.WHITE)
        .text(value, sx + 5.5, cy + 9.6 * MM, { lineBreak: false })
      doc.font('Helvetica').fontSize(5.6).fillColor(THEME.GRAY)
      doc.text(fit(doc, label.toUpperCase(), (tw - 2 * pad) / 2 - 6), sx + 5.5, cy + 14.2 * MM, {
        lineBreak: false,
        characterSpacing: 0.3,
      })
    })
  })
  y += Math.ceil(topics.length / 3) * (th + 4 * MM) + 4 * MM

  // answer shapes
  const groups = evidence.shapes.groups.slice(0, 5)
  if (groups.length > 0) {
    y = sectionHead(doc, M, y, CW, s.shapesTitle)
    const colX = [M, M + 44 * MM, M + 72 * MM, M + 98 * MM, M + 126 * MM, M + 150 * MM]
    doc.font('Helvetica').fontSize(6).fillColor(THEME.GRAY)
    s.shapeHeaders.forEach((h, i) => {
      doc.text(h, colX[i] ?? M, y, { lineBreak: false, characterSpacing: 0.5 })
    })
    y += 4.5 * MM
    doc.save().lineWidth(0.5).moveTo(M, y - 1 * MM).lineTo(W - M, y - 1 * MM).stroke(THEME.FAINT).restore()
    for (const g of groups) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(THEME.LAVENDER)
      doc.text(fit(doc, g.signature, 41 * MM), colX[0] ?? M, y, { lineBreak: false })
      doc.font('Helvetica').fontSize(8.5).fillColor(THEME.WHITE)
      doc.text(String(g.answers), colX[1] ?? M, y, { lineBreak: false })
      doc.text(String(g.avgChars), colX[2] ?? M, y, { lineBreak: false })
      doc.text(String(g.avgCitedUrls), colX[3] ?? M, y, { lineBreak: false })
      doc.fillColor(THEME.BLUE).text(pct(g.citationRate), colX[4] ?? M, y, { lineBreak: false })
      doc.fillColor(THEME.LIGHT).text(pct(g.mentionRate), colX[5] ?? M, y, { lineBreak: false })
      y += 6.4 * MM
    }
    const p = evidence.shapes.prevalence
    doc.font('Helvetica').fontSize(6.5).fillColor(THEME.GRAY)
    doc.text(
      fit(
        doc,
        s.prevalenceLine({
          lists: p.lists,
          tables: p.tables,
          numbers: p.numbers,
          avgChars: p.avgChars,
          answers: evidence.shapes.answersAnalyzed,
        }),
        CW,
      ),
      M,
      y + 1.5 * MM,
      { lineBreak: false },
    )
  }
}

// ─── P7 Geo & persona ───────────────────────────────────────────────────────

function pageGeoPersona(ctx: Ctx, pageNo: number): void {
  const { doc, s, company, input } = ctx
  let y = header(ctx, pageNo, s.p7Kicker, s.p7Title)

  y = sectionHead(doc, M, y, CW, s.ladderTitle)
  steppedLadder(doc, M, y, CW, 52 * MM, ctx.geo)
  y += 58 * MM

  // persona split
  y = sectionHead(doc, M, y, CW, s.personaTitle)
  const tw = 58 * MM
  const th = 24 * MM
  statTile(doc, M, y, tw, th, {
    label: s.personaGeneral,
    value: pct(ctx.personaGeneral),
    sub: s.personaGeneralSub,
    accent: THEME.BLUE,
  })
  statTile(doc, M + tw + 4 * MM, y, tw, th, {
    label: s.personaAvatar,
    value: pct(ctx.personaAvatar),
    sub: s.personaAvatarSub,
    accent: THEME.PURPLE,
  })
  // avatar-vs-general delta, anchored inside the avatar tile (top right)
  const delta = ctx.personaAvatar - ctx.personaGeneral
  doc.font('Helvetica-Bold').fontSize(6.5)
  const deltaW = doc.widthOfString(`${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)} pt`) + 19
  deltaChip(doc, M + 2 * tw + 4 * MM - deltaW - 4 * MM, y + 3.2 * MM, delta)
  y += th + 8 * MM

  // avatar card — prominent in the avatar variant, contextual note otherwise
  if (company.buyerPersona) {
    const ch = ctx.variant === 'avatar' ? 26 * MM : 22 * MM
    doc.roundedRect(M, y, CW, ch, 5).fill(THEME.CARD)
    doc.save().roundedRect(M, y, CW, ch, 5).clip()
    doc.rect(M, y, 2.4, ch).fill(THEME.PURPLE)
    doc.restore()
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(THEME.PURPLE)
      .text(s.avatarKicker, M + 6 * MM, y + 4.5 * MM, { lineBreak: false, characterSpacing: 1.2 })
    if (ctx.variant === 'avatar') {
      para(doc, company.buyerPersona, M + 6 * MM, y + 9.5 * MM, CW - 12 * MM, 10.5, THEME.LAVENDER, 3, 'Helvetica-Bold')
    } else {
      para(doc, `${s.avatarNoteGeneral} ${company.buyerPersona}`, M + 6 * MM, y + 9 * MM, CW - 12 * MM, 8.5, THEME.LIGHT, 3)
    }
    y += ch + 8 * MM
  }

  const pulls = input.sections.KEY_INSIGHTS.slice(0, 3)
  if (pulls.length > 0) {
    y = sectionHead(doc, M, y, CW, s.insightsTitle)
    for (const line of pulls) y = bullet(doc, M, y, CW, line)
  }
}

// ─── P8 Sentiment ───────────────────────────────────────────────────────────

function pageSentiment(ctx: Ctx, pageNo: number): void {
  const { doc, s, input } = ctx
  const sent = input.sentiment as SentimentReport
  let y = header(ctx, pageNo, s.p8Kicker, s.p8Title, s.p8Lede)

  y = segmentedBand(
    doc,
    M,
    y + 1 * MM,
    CW,
    9 * MM,
    [
      { label: s.pos, value: sent.positive, color: THEME.GREEN },
      { label: s.neu, value: sent.neutral, color: THEME.GRAY },
      { label: s.neg, value: sent.negative, color: THEME.RED },
    ],
    true,
  ) + 4 * MM

  // per-engine positive share
  const engPos = ctx.engs
    .map((e) => ({ e, v: ctx.engStat(e).sentimentPosPct }))
    .filter((x): x is { e: Engine; v: number } => x.v !== null)
  if (engPos.length > 0) {
    y = sectionHead(doc, M, y, CW, s.engPosTitle)
    const tw = (CW - 12 * MM) / 4
    engPos.slice(0, 4).forEach((x, i) => {
      statTile(doc, M + i * (tw + 4 * MM), y, tw, 20 * MM, {
        label: ENG_LABEL[x.e],
        value: pct(x.v),
        sub: s.posShare,
        accent: x.v >= 50 ? THEME.GREEN : x.v >= 25 ? THEME.BLUE : THEME.RED,
      })
    })
    y += 27 * MM
  }

  // trend sparkline
  if (sent.trend.length >= 2) {
    y = sectionHead(doc, M, y, CW, s.trendTitle)
    const card = 34 * MM
    doc.roundedRect(M, y, CW, card, 5).fill(THEME.CARD)
    const pad = 7 * MM
    const pts = sent.trend.slice(-12)
    sparkline(doc, M + pad, y + pad, CW - 2 * pad - 14 * MM, card - 2 * pad, pts.map((p) => p.positivePct), THEME.GREEN)
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (first && last) {
      doc
        .font('Helvetica')
        .fontSize(6.3)
        .fillColor(THEME.GRAY)
        .text(first.at.slice(5), M + pad, y + card - 5 * MM, { lineBreak: false })
      const lastLbl = last.at.slice(5)
      doc.text(lastLbl, M + pad + (CW - 2 * pad - 14 * MM) - doc.widthOfString(lastLbl), y + card - 5 * MM, {
        lineBreak: false,
      })
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(THEME.GREEN)
        .text(pct(last.positivePct), W - M - pad - 12 * MM, y + card / 2 - 4, { lineBreak: false })
    }
    y += card + 7 * MM
  }

  const pulls = input.sections.KEY_INSIGHTS.slice(3, 6).length > 0
    ? input.sections.KEY_INSIGHTS.slice(3, 6)
    : input.sections.EXEC_SUMMARY.slice(0, 3)
  if (pulls.length > 0) {
    y = sectionHead(doc, M, y, CW, s.narrativeTitle)
    for (const line of pulls) y = bullet(doc, M, y, CW, line)
  }
}

// ─── P9 Competitor teardown ─────────────────────────────────────────────────

function teardownPatterns(ctx: Ctx, pages: readonly CompetitorPage[]): string[] {
  const { s, lang } = ctx
  const total = pages.length
  if (total === 0) return []
  const p = (n: number) => Math.round((100 * n) / total)
  const candidates: Array<{ count: number; text: (pv: number) => string }> = [
    { count: pages.filter((x) => x.schemaMarkup !== undefined).length, text: s.patSchema },
    { count: pages.filter((x) => x.hasFaq).length, text: s.patFaq },
    { count: pages.filter((x) => (x.wordCount ?? 0) >= 1500).length, text: s.patLong },
    { count: pages.filter((x) => x.hasComparisonTable).length, text: s.patTable },
    { count: pages.filter((x) => x.hasStatistics).length, text: s.patStats },
  ]
  const out = candidates
    .filter((c) => c.count / total >= 0.5)
    .sort((a, b) => b.count - a.count)
    .map((c) => c.text(p(c.count)))
  const byFormat = new Map<NonNullable<CompetitorPage['answerFormat']>, number>()
  for (const pg of pages) {
    if (pg.answerFormat) byFormat.set(pg.answerFormat, (byFormat.get(pg.answerFormat) ?? 0) + 1)
  }
  const dominant = [...byFormat.entries()].sort((a, b) => b[1] - a[1])[0]
  if (dominant && dominant[1] / total >= 0.5) {
    out.push(s.patFormat(FORMAT_LABEL[lang][dominant[0]], p(dominant[1])))
  }
  return out.slice(0, 5)
}

function pageTeardown(ctx: Ctx, pageNo: number): void {
  const { doc, s, lang, input } = ctx
  const pages = input.competitorPages ?? []
  let y = header(ctx, pageNo, s.p9Kicker, s.p9Title, s.p9Lede)

  // rank by supply-chain citations of the page's domain, then word count
  const citesByDomain = new Map<string, number>()
  for (const d of input.evidence?.supplyChain.domains ?? []) citesByDomain.set(d.domain, d.citations)
  const ranked = [...pages].sort(
    (a, b) =>
      (citesByDomain.get(b.competitorDomain) ?? 0) - (citesByDomain.get(a.competitorDomain) ?? 0) ||
      (b.wordCount ?? 0) - (a.wordCount ?? 0),
  )

  for (const pg of ranked.slice(0, 3)) {
    const ch = 28 * MM
    doc.roundedRect(M, y, CW, ch, 5).fill(THEME.CARD)
    doc.save().roundedRect(M, y, CW, ch, 5).clip()
    doc.rect(M, y, 2.4, ch).fill(THEME.BLUE)
    doc.restore()
    const pad = 5.5 * MM
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(THEME.BLUE)
      .text(pg.competitorDomain, M + pad, y + 4 * MM, { lineBreak: false })
    const cites = citesByDomain.get(pg.competitorDomain) ?? 0
    if (cites > 0) {
      doc.font('Helvetica').fontSize(6.5)
      const ct = `${cites} ${s.citations}`
      doc.fillColor(THEME.GRAY).text(ct, W - M - pad - doc.widthOfString(ct), y + 4 * MM, { lineBreak: false })
    }
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(THEME.WHITE)
    doc.text(fit(doc, pg.title ?? pg.url, CW - 2 * pad), M + pad, y + 9 * MM, { lineBreak: false })
    // structure chips
    let chx = M + pad
    const chy = y + 15 * MM
    chx += chip(doc, chx, chy, FORMAT_LABEL[lang][pg.answerFormat ?? 'prose'], { color: THEME.LAVENDER, bold: true }) + 4
    if (pg.wordCount !== undefined) {
      chx += chip(doc, chx, chy, `${pg.wordCount} ${s.words}`, { color: THEME.LIGHT }) + 4
    }
    // feature chips — a feature identical to the answer format is not repeated
    const feats: Array<[boolean, string]> = [
      [pg.hasFaq && pg.answerFormat !== 'faq', s.chipFaq],
      [pg.hasComparisonTable && pg.answerFormat !== 'table', s.chipTable],
      [pg.hasStatistics, s.chipStats],
      [pg.schemaMarkup !== undefined, s.chipSchema],
    ]
    for (const [present, label] of feats) {
      if (present) chx += chip(doc, chx, chy, label, { color: THEME.BLUE, dot: true }) + 4
    }
    const heading = pg.headings[0]
    if (heading) {
      doc.font('Helvetica').fontSize(7).fillColor(THEME.GRAY)
      doc.text(fit(doc, `› ${heading}`, CW - 2 * pad), M + pad, y + 22 * MM, { lineBreak: false })
    }
    y += ch + 4 * MM
  }
  y += 3 * MM

  const patterns = teardownPatterns(ctx, pages)
  if (patterns.length > 0) {
    y = sectionHead(doc, M, y, CW, s.patternsTitle)
    for (const line of patterns) y = bullet(doc, M, y, CW, line)
  }
}

// ─── P10 Evidence log ───────────────────────────────────────────────────────

function pageEvidenceLog(ctx: Ctx, pageNo: number): void {
  const { doc, s, lang, input } = ctx
  const evidence = input.evidence as ReportEvidence
  const verification = evidence.verification ?? {}
  let y = header(ctx, pageNo, s.p10Kicker, s.p10Title, s.p10Lede)

  for (const snip of evidence.bundle.topSnippets.slice(0, 5)) {
    const ch = 39 * MM
    const accent = snip.cited ? THEME.GREEN : snip.mentioned ? THEME.PURPLE : THEME.GRAY
    doc.roundedRect(M, y, CW, ch, 5).fill(THEME.CARD)
    doc.save().roundedRect(M, y, CW, ch, 5).clip()
    doc.rect(M, y, 2.4, ch).fill(accent)
    doc.restore()
    const pad = 5.5 * MM
    // chips row
    let chx = M + pad
    chx += chip(doc, chx, y + 3.5 * MM, ENG_LABEL[snip.engine], { color: THEME.BLUE, bold: true }) + 4
    chx += chip(doc, chx, y + 3.5 * MM, TOPIC_LABEL[lang][snip.topic], { color: THEME.LIGHT }) + 4
    chip(doc, chx, y + 3.5 * MM, snip.cited ? s.evCited : snip.mentioned ? s.evMentioned : s.evInvisible, {
      color: accent,
      bold: true,
      dot: true,
    })
    // prompt
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(THEME.WHITE)
    doc.text(fit(doc, snip.prompt, CW - 2 * pad), M + pad, y + 10.5 * MM, { lineBreak: false })
    // verbatim excerpt — pre-clipped on a word boundary so the third line
    // never ends mid-word without a visible ellipsis
    const excerpt =
      snip.answerExcerpt.length > 240
        ? `${snip.answerExcerpt.slice(0, 240).replace(/\s+\S*$/, '')} …`
        : snip.answerExcerpt
    para(doc, excerpt, M + pad, y + 16 * MM, CW - 2 * pad, 7.5, THEME.LIGHT, 3)
    // sources with verification dots
    const sy = y + ch - 6.5 * MM
    let sx = M + pad
    doc.font('Helvetica').fontSize(6.5)
    const label = `${s.evSources}:`
    doc.fillColor(THEME.GRAY).text(label, sx, sy, { lineBreak: false })
    sx += doc.widthOfString(label) + 8
    const seen = new Set<string>()
    for (const u of snip.citedUrls) {
      const host = hostOf(u)
      if (seen.has(host)) continue
      seen.add(host)
      if (seen.size > 4) break
      const v = verification[u]
      const dot = v === true ? THEME.GREEN : v === false ? THEME.RED : THEME.GRAY
      doc.font('Helvetica').fontSize(6.5)
      const tw = doc.widthOfString(host)
      if (sx + 8 + tw > W - M - pad) break
      doc.circle(sx + 2.2, sy + 2.6, 2).fill(dot)
      doc.fillColor(THEME.LIGHT).text(host, sx + 7, sy, { lineBreak: false })
      sx += 7 + tw + 12
    }
    if (seen.size === 0) doc.fillColor(THEME.GRAY).text('—', sx, sy, { lineBreak: false })
    y += ch + 4 * MM
  }
}

// ─── P11 Roadmap & impact ───────────────────────────────────────────────────

function pageRoadmap(ctx: Ctx, pageNo: number): void {
  const { doc, s, input } = ctx
  const impact = input.impact
  let y = header(ctx, pageNo, s.p11Kicker, s.p11Title)

  // split ACTIONS across P1/P2/P3
  const actions = input.sections.ACTIONS.map(clean).filter((a) => a.length > 0).slice(0, 6)
  const groups: string[][] = [actions.slice(0, 2), actions.slice(2, 4), actions.slice(4, 6)]
  const prioColor = [THEME.RED, THEME.PURPLE, THEME.BLUE]
  groups.forEach((lines, gi) => {
    if (lines.length === 0) return
    chip(doc, M, y, s.prio[gi] ?? '', { color: prioColor[gi] ?? THEME.GRAY, bold: true, dot: true })
    y += 7.5 * MM
    lines.forEach((line, li) => {
      const n = gi === 0 ? li + 1 : gi === 1 ? li + 1 + groups[0]!.length : li + 1 + groups[0]!.length + groups[1]!.length
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(prioColor[gi] ?? THEME.GRAY)
        .text(String(n).padStart(2, '0'), M + 1 * MM, y + 0.5, { lineBreak: false })
      y = para(doc, line, M + 9 * MM, y, CW - 9 * MM, 8.5, THEME.WHITE, 2) + 2.6 * MM
    })
    y += 3 * MM
  })
  y += 2 * MM

  // modeled impact
  y = sectionHead(doc, M, y, CW, s.impactTitle, THEME.RED)
  const tw = (CW - 8 * MM) / 3
  const tiles: Array<[string, string, string]> = [
    [s.impClicks, `~${chf(impact.divertedClicksMonth)}`, s.impClicksSub],
    [s.impLeads, `~${chf(impact.lostLeadsMonth)}`, s.impLeadsSub],
    [s.impChf, `CHF ${chf(impact.lostChfMonth)}`, s.impChfSub],
  ]
  tiles.forEach(([label, value, sub], i) => {
    statTile(doc, M + i * (tw + 4 * MM), y, tw, 23 * MM, { label, value, sub, accent: THEME.RED })
  })
  y += 27 * MM
  doc.font('Helvetica').fontSize(7.5).fillColor(THEME.LIGHT)
  doc.text(fit(doc, s.impCompNote(impact.competitorLeadsMonth, chf(impact.competitorChfMonth)), CW), M, y, {
    lineBreak: false,
  })
  y += 4.5 * MM
  doc.font('Helvetica').fontSize(6.3).fillColor(THEME.GRAY)
  doc.text(
    fit(
      doc,
      s.impAssumptions({
        value: chf(impact.assumptions.projectValueChf),
        queries: chf(impact.assumptions.queriesPerMonth),
        ctr: `${Math.round(impact.assumptions.ctrOther * 100)}%`,
        conv: `${Math.round(impact.assumptions.conversion * 100)}%`,
      }),
      CW,
    ),
    M,
    y,
    { lineBreak: false },
  )
  y += 9 * MM

  // closer banner
  const closer = clean(input.sections.CLOSER[0] ?? '')
  if (closer) {
    const ch = 26 * MM
    doc.roundedRect(M, y, CW, ch, 5).fill(THEME.CARD)
    doc.save().roundedRect(M, y, CW, ch, 5).clip()
    doc.rect(M, y, 2.4, ch).fill(THEME.PURPLE)
    doc.restore()
    doc
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .fillColor(THEME.PURPLE)
      .text(s.closerKicker, M + 6 * MM, y + 4.5 * MM, { lineBreak: false, characterSpacing: 1.3 })
    para(doc, closer, M + 6 * MM, y + 9.5 * MM, CW - 12 * MM, 11, THEME.LAVENDER, 2, 'Helvetica-Bold')
  }
}

// ─── P12 Methodology ────────────────────────────────────────────────────────

function pageMethodology(ctx: Ctx, pageNo: number): void {
  const { doc, s, company, input } = ctx
  let y = header(ctx, pageNo, s.p12Kicker, s.p12Title)

  const vars: MethodVars = {
    engines: ctx.engs.map((e) => ENG_LABEL[e]).join(', '),
    runs: input.score.overall.runsOk,
    prompts: ctx.promptCount,
    locations: company.locations.length > 0 ? company.locations.join(', ') : company.location,
    date: ctx.today,
    assumptions: input.impact.assumptions,
  }
  s.meth.forEach((m, i) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(THEME.PURPLE)
      .text(String(i + 1).padStart(2, '0'), M, y, { lineBreak: false })
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(THEME.WHITE)
      .text(m.title, M + 12 * MM, y + 1, { lineBreak: false })
    y = para(doc, m.body(vars), M + 12 * MM, y + 6.5 * MM, CW - 12 * MM, 8, THEME.LIGHT, 5) + 6 * MM
  })

  y += 4 * MM
  doc.save().lineWidth(0.5).moveTo(M, y).lineTo(W - M, y).stroke(THEME.FAINT).restore()
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(THEME.LIGHT)
    .text(s.contact, M, y + 5 * MM, { lineBreak: false })
}

// ─── Deck runner ────────────────────────────────────────────────────────────

/** Render the full dossier onto `doc` (doc must already have its first page). */
export function renderDeck(doc: Doc, input: DeckInput): void {
  const ctx = buildCtx(doc, input)
  const { evidence, sentiment, competitorPages } = input

  const hasEvidence = evidence !== undefined && evidence.bundle.runsOk > 0
  const s = ctx.s
  // Cover draws its own chrome; the runner adds bg + footer for every page.
  // Titles feed the cover's contents list.
  const plan: Array<{ title: string | null; render: (pageNo: number) => void }> = [
    { title: null, render: () => pageCover(ctx) },
    { title: s.p2Title, render: (p) => pageEngines(ctx, p) },
    { title: s.p3Title, render: (p) => pageLeaderboard(ctx, p) },
    { title: s.p4Title, render: (p) => pageGates(ctx, p) },
  ]
  if (hasEvidence && evidence.supplyChain.domains.length > 0)
    plan.push({ title: s.p5Title, render: (p) => pageSupplyChain(ctx, p) })
  if (hasEvidence && evidence.bundle.topics.length > 0)
    plan.push({ title: s.p6Title, render: (p) => pageTopics(ctx, p) })
  plan.push({ title: s.p7Title, render: (p) => pageGeoPersona(ctx, p) })
  if (sentiment && sentiment.total > 0) plan.push({ title: s.p8Title, render: (p) => pageSentiment(ctx, p) })
  if (competitorPages && competitorPages.length > 0)
    plan.push({ title: s.p9Title, render: (p) => pageTeardown(ctx, p) })
  if (hasEvidence && evidence.bundle.topSnippets.length > 0)
    plan.push({ title: s.p10Title, render: (p) => pageEvidenceLog(ctx, p) })
  plan.push({ title: s.p11Title, render: (p) => pageRoadmap(ctx, p) })
  plan.push({ title: s.p12Title, render: (p) => pageMethodology(ctx, p) })

  ctx.toc = plan
    .map((p, i) => ({ no: i + 1, title: p.title }))
    .filter((e): e is { no: number; title: string } => e.title !== null)

  const total = plan.length
  plan.forEach((page, i) => {
    if (i > 0) doc.addPage()
    paintBg(doc)
    page.render(i + 1)
    footer(ctx, i + 1, total)
  })
}
