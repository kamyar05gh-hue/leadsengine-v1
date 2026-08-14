/**
 * Competitor discovery — extract the companies engines actually recommend.
 *
 * Firm names appear bolded in answers (**Kaladent AG**, **Webrepublic**).
 * Regex-pattern discovery over prose was dropped upstream — it produced junk
 * names and missed the real competitors.
 *
 * v2 (sector-neutral): the original filter was hardcoded for the dental
 * niche — BUSINESS_RX required a legal form or a dental trade name, and the
 * junk list matched city substrings ("bern" junked "Bernet PR"). Both made
 * competitor discovery return near-empty sets for any other sector, which is
 * one reason whole audits showed zero competitor citations. The v2 filter:
 *  - junk terms match as whole words, not substrings;
 *  - place names only disqualify when they ARE the whole candidate;
 *  - business-likeness: legal form OR ≥2 capitalized tokens OR a single
 *    brand-like token — single-token names must appear in ≥2 answers to
 *    survive (one bolded word alone is weak evidence of a company).
 */
import type { AuditRecord, Company, Competitor } from '../types.js'
import { clientPattern } from './regex.js'

/** Bolded spans in markdown answers: **Name** (2–45 chars, no inner *). */
const BOLD_RX = /\*\*([^*]{2,45})\*\*/g
/** Markdown link targets inside a bold span, e.g. **[Name](url)** → strip "[Name]". */
const LINK_RX = /\[.*?]/g

/** Generic section-header / filler words — junk anywhere in the candidate. */
const JUNK_RX =
  /\b(tipp|hinweis|fazit|empfehlung(en)?|checkliste|kosten|preis(e)?|vorteile?|nachteile?|schritt(e)?|beispiel(e)?|wichtig|frage(n)?|antwort(en)?|zusammenfassung|übersicht|kriterien|leistung(en)?|angebot(e)?|auswahl|vergleich|anbieter|firma|firmen|unternehmen|agenturen)\b/i

/**
 * Marketing/service vocabulary — German capitalizes every noun, so engines
 * bold service terms (**Employer Branding**, **Budgetüberlegungen**) exactly
 * like brand names and the capitalization heuristics cannot tell them apart.
 * A candidate made ONLY of these words (plus fillers) is a topic, not a firm.
 */
const SERVICE_WORDS = new Set([
  'social', 'media', 'marketing', 'online', 'digital', 'content', 'lead',
  'leads', 'employer', 'branding', 'brand', 'awareness', 'ads', 'werbung',
  'werbebudget', 'budget', 'budgets', 'budgetüberlegungen', 'überlegung',
  'überlegungen', 'produktion', 'erstellung', 'generierung', 'strategie',
  'strategien', 'kampagne', 'kampagnen', 'zielgruppe', 'zielgruppen',
  'plattform', 'plattformen', 'kanal', 'kanäle', 'community', 'management',
  'monitoring', 'analyse', 'analysen', 'reporting', 'beratung', 'schulung',
  'workshop', 'workshops', 'seo', 'sea', 'performance', 'recruiting',
  'erfahrung', 'erfahrungen', 'branchenerfahrung', 'referenzen', 'bewertung',
  'bewertungen', 'kundenbewertungen', 'transparenz', 'kommunikation',
  'zusammenarbeit', 'betreuung', 'paket', 'pakete', 'stundensatz', 'honorar',
  'kostenrahmen', 'preismodell', 'preismodelle', 'leistungsumfang', 'vertrag',
  'vertragslaufzeit', 'kündigungsfrist', 'ergebnis', 'ergebnisse', 'ziel',
  'ziele', 'prozess', 'ablauf', 'grundlagen', 'einführung', 'trend', 'trends',
  'roi', 'fokus', 'kpi', 'kpis', 'conversion', 'conversions', 'reichweite',
  'bedarfsanalyse', 'angebotseinholung', 'angebotsvergleich', 'anforderungen',
  'auswahlkriterien', 'entscheidung', 'entscheidungshilfe', 'vorgehen',
  'kickoff', 'onboarding', 'briefing', 'evaluation', 'shortlist',
  // medical / aesthetic-surgery procedure vocabulary
  'facelift', 'botox', 'filler', 'nachsorge', 'vorsorge', 'narkose',
  'anästhesie', 'implantat', 'implantate', 'lifting', 'eigenfett',
  'korrektur', 'rhinoplastik', 'liposuktion', 'augmentation', 'op', 'eingriff',
  'eingriffe', 'operation', 'operationen', 'klinikwahl', 'arztwahl',
  'hygiene', 'sicherheit', 'risiko', 'risiken', 'heilung', 'narben',
  'kosten', 'preis', 'preise', 'qualifikation', 'facharzt', 'chirurg',
  'chirurgie', 'medizin', 'patient', 'patienten', 'diagnose', 'therapie',
  'titel', 'kasse', 'krankenkasse', 'gynäkomastie', 'zertifizierung',
])

/**
 * Social/tech platforms and tools — engines bold them constantly
 * (**LinkedIn**, **Instagram**) but they are channels, not competitors.
 */
const PLATFORM_RX =
  /^(linkedin|instagram|facebook|tiktok|youtube|twitter|x|xing|pinterest|snapchat|whatsapp|threads|meta|google|google\s?ads|meta\s?ads|canva|hootsuite|hubspot|mailchimp|wordpress|shopify|chatgpt|gemini|perplexity|claude)$/i

/** Connector/filler words ignored when judging service-topic candidates. */
const FILLER_WORDS = new Set([
  'und', 'oder', 'für', 'mit', 'ohne', 'im', 'in', 'am', 'an', 'auf', 'der',
  'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'and', 'or',
  'for', 'with', 'of', 'the', 'a', 'an',
  // qualifiers: they modify a topic, they never identify a firm
  'mini', 'vorher', 'nachher', 'realistische', 'realistisch', 'neue', 'neu',
  'gross', 'grosse', 'klein', 'kleine', 'gut', 'gute', 'beste', 'top',
])

/**
 * German builds unlimited compound service nouns (Leistungsangebot,
 * Auswahlkriterien…) — a dictionary can't enumerate them, but their heads
 * are a small closed set of suffixes.
 */
const SERVICE_SUFFIX_RX =
  /(angebot(e|s)?|analyse[n]?|kriteri(en|um)|umfang|prozess(e)?|strategie[n]?|budget(s)?|erfahrung(en)?|bewertung(en)?|leistung(en)?|überlegung(en)?|produktion|erstellung|generierung|betreuung|beratung|verwaltung|planung|optimierung|steigerung|messung|kontrolle|struktur(en)?|modell(e)?|übersicht|vergleich(e)?|auswahl|einholung|barkeit|keit|heit|ung(en)?|plastik|ektomie|tomie|therapie|skopie|logie|lifting|korrektur(en)?|gespräch(e)?|schaft(en)?|methode(n)?|technik(en)?|verfahren|eingriff(e)?|injektion(en)?|peeling|operation(en)?|option(en)?|bild(er)?|implantat(en|e)?|erwartung(en)?|beratung(en)?|garantie(n)?|zertifikat(e)?|titel|kasse(n)?|mastie|itis|syndrom(e)?|versicherung(en)?|toxin|komplikation(en)?)$/i

/** True when the candidate is service vocabulary/topic, not a firm name. */
function isServiceTopic(name: string): boolean {
  const tokens = name
    .toLowerCase()
    .split(/[\s&+/-]+/)
    .map((t) => t.replace(/[^\wäöü]/g, ''))
    .filter((t) => t && !FILLER_WORDS.has(t))
  if (tokens.length === 0) return true
  return tokens.every((t) => SERVICE_WORDS.has(t) || SERVICE_SUFFIX_RX.test(t))
}

/** Candidates that ARE just a place / market label, not a company. */
const PLACE_RX =
  /^(schweiz|switzerland|bern|zürich|zuerich|zurich|basel|genf|geneva|lausanne|luzern|st\.?\s?gallen|winterthur|deutschschweiz|romandie|ticino|dach|europa)$/i

/** Candidates that are just the category, not a brand. */
const GENERIC_RX =
  /^(die|der|das|eine?|social\s?media(\s?marketing)?|marketing|online\s?marketing|content\s?marketing|seo|sea|ads?|werbeagentur|webagentur|webdesign|branding|kommunikation|digital(agentur)?|full[-\s]?service)$/i

/** Legal forms and strong company markers. */
const LEGAL_RX = /\b(AG|GmbH|SA|Sàrl|Sarl|KG|OHG|mbH|Ltd|LLC|Inc|Gruppe|Group|Studio|Agentur|Agency)\b/

/**
 * Price/currency spans ("CHF 800 bis CHF 2'000 pro Monat") get bolded by
 * engines just like brand names. A digit-leading token ("800", "2'000")
 * previously counted as "capitalized" in the ≥2-capitalized-tokens rule,
 * so a whole price range could pass as a 2-word company name.
 */
const CURRENCY_RX = /\b(CHF|EUR|USD|Fr\.?|€|\$)\b/i
/** True when a token is a plain number/currency amount, not a word. */
function isNumericToken(t: string): boolean {
  return /^[\d.,'’]+$/.test(t) || /^(chf|eur|usd|fr\.?|€|\$)$/i.test(t)
}

/** True when the candidate plausibly names a business. */
function looksLikeBusiness(name: string): boolean {
  if (CURRENCY_RX.test(name) || /\d/.test(name)) return false
  if (LEGAL_RX.test(name)) return true
  const tokens = name.split(/\s+/)
  // capitalized letter-led tokens only — digits no longer qualify
  const capitalized = tokens.filter((t) => !isNumericToken(t) && /^[A-ZÄÖÜ]/.test(t))
  if (tokens.length >= 2 && capitalized.length >= 2) return true
  // single brand-like token: capitalized or camel-cased, 4–24 chars
  return tokens.length === 1 && /^[A-ZÄÖÜ][\wäöüÄÖÜ&.-]{3,23}$/.test(name)
}

/**
 * Public quality gate for a candidate competitor name — the same checks
 * `discoverCompetitors` applies internally, exposed so callers holding a
 * name from elsewhere (e.g. a previously stored reverse-engineering report)
 * can re-validate it against the current rules before trusting it. Useful
 * after a discovery-logic fix: old cached rows keyed by name don't
 * automatically get re-filtered otherwise.
 */
export function isPlausibleCompanyName(name: string): boolean {
  return (
    !JUNK_RX.test(name) &&
    !PLACE_RX.test(name) &&
    !GENERIC_RX.test(name) &&
    !isServiceTopic(name) &&
    !PLATFORM_RX.test(name) &&
    looksLikeBusiness(name)
  )
}

/**
 * Discover competitors from bolded names in ok records. Names are deduped
 * per record (case-insensitive) and counted once per record they appear in;
 * the top `cap` by hit count are returned, ties in first-seen order.
 */
export function discoverCompetitors(
  records: AuditRecord[],
  company: Company,
  cap = 7,
): Competitor[] {
  const clientRx = clientPattern(company)
  // Map preserves insertion order so ties rank stably.
  const counts = new Map<string, number>()
  const isSingleToken = new Map<string, boolean>()

  for (const rec of records) {
    if (!rec.ok || !rec.text) continue
    const seen = new Set<string>()
    for (const m of rec.text.matchAll(BOLD_RX)) {
      const raw = m[1] ?? ''
      const name = raw
        .replace(LINK_RX, '')
        .trim()
        .replace(/^[:#*\d.\s-]+|[:.,;!?\s]+$/g, '')
        // "Lucerne Clinic (Luzern)" and "Lucerne Clinic" are one competitor
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim()
        .trim()
      if (name.length < 4 || name.length > 45) continue
      if (clientRx.test(name)) continue
      if (JUNK_RX.test(name) || PLACE_RX.test(name) || GENERIC_RX.test(name)) continue
      if (isServiceTopic(name) || PLATFORM_RX.test(name)) continue
      if (!looksLikeBusiness(name)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      counts.set(name, (counts.get(name) ?? 0) + 1)
      isSingleToken.set(name, !/\s/.test(name) && !LEGAL_RX.test(name))
    }
  }

  return [...counts.entries()]
    // single bare tokens need corroboration across ≥2 answers
    .filter(([name, hits]) => hits >= 2 || !isSingleToken.get(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([name, rawHits]) => ({ name, rawHits }))
}
