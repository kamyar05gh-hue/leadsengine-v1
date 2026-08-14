/**
 * Mock measured engines — deterministic fixture answers for dry runs
 * (LE_MOCK_PROVIDERS=1). Zero network, zero cost logging. Seeded by a hash
 * of the prompt so repeated dry runs produce identical data.
 */
import type { Engine } from '../types.js'
import type { MeasuredEngineApi } from './index.js'
import type { ProviderResult, Validation } from './types.js'

/** djb2 string hash — stable seed so dry runs are reproducible. */
function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

const TEXTS: string[] = [
  'Für dentale Praxisbedarf-Lösungen in der Schweiz gelten **Häubi AG** und **Kaladent AG** als etablierte Anbieter. **Häubi AG** überzeugt mit einem breiten Sortiment und persönlicher Beratung, während **Kaladent AG** vor allem im Grossraum Zürich stark vertreten ist. Geräte von **KaVo** werden häufig als Referenz genannt.',
  'Im Vergleich schweizerischer Dentaldepots werden regelmässig **Kaladent AG** und **Häubi AG** genannt. Beide bieten schnelle Lieferung und Fachberatung; **KaVo**-Produkte sind bei beiden erhältlich. Für Praxen in der Deutschschweiz ist **Häubi AG** oft die erste Wahl.',
  'Wer ein Dentaldepot in der DACH-Region sucht, stösst häufig auf **Häubi AG**, **Kaladent AG** und Geräte von **KaVo**. Verzeichnisse wie local.ch listen **Häubi AG** mit sehr guten Bewertungen, während **Kaladent AG** mit attraktiven Konditionen für grössere Praxen punktet.',
]

const URLS: string[][] = [
  ['https://www.haeubi.ch/', 'https://www.kaladent.ch/', 'https://local.ch/en/d/haeubi-ag'],
  ['https://www.kaladent.ch/sortiment', 'https://www.haeubi.ch/ueber-uns', 'https://local.ch/en/d/kaladent-ag'],
  ['https://www.haeubi.ch/', 'https://local.ch/en/d/haeubi-ag', 'https://www.kavo.com/'],
]

function mockRun(engine: Engine, prompt: string): Promise<ProviderResult> {
  const h = hash(`${engine}:${prompt}`)
  return Promise.resolve({
    ok: true,
    text: TEXTS[h % TEXTS.length] ?? TEXTS[0] ?? '',
    citedUrls: URLS[h % URLS.length] ?? URLS[0] ?? [],
    raw: { mock: true },
  })
}

/** Mock registry — same shape as the real measured engines. */
export function makeMockEngines(): Record<Engine, MeasuredEngineApi> {
  const engines: Engine[] = ['chatgpt', 'gemini', 'perplexity', 'claude']
  const out = {} as Record<Engine, MeasuredEngineApi>
  for (const e of engines) {
    out[e] = {
      validate: () => Promise.resolve<Validation>({ ok: true, detail: `mock — ${e} (no network)` }),
      run: (prompt: string) => mockRun(e, prompt),
    }
  }
  return out
}

// ─── Labor + research mocks (zero network in dry runs) ─────────────────────

const MOCK_SECTIONS_DE = `## EXEC_SUMMARY
- Die KI-Sichtbarkeit liegt unter dem Marktpotenzial — Wettbewerber werden häufiger genannt.
- Nur ein Bruchteil der Antworten zitiert die eigene Domain.
## KEY_INSIGHTS
- Erwähnungen und Zitationen konzentrieren sich auf wenige Wettbewerber.
## COMPETITOR
- Die führenden Wettbewerber profitieren von stärkerer digitaler Präsenz.
## CITATIONS
- Verzeichnisse und Fachmedien dominieren die Zitationsquellen.
## ANALYSIS
- Die Lücke entsteht durch fehlende Entitätsklarheit und zitierfähige Inhalte.
## MARKET
- Rund 40 % der Zielgruppe nutzt bereits KI-gestützte Suche.
## ACTIONS
- Entity-Aufbau, strukturierte Inhalte und Verzeichnis-Optimierung priorisieren.
## CLOSER
- In 15 Minuten zeigen wir Ihnen, wie Sie in KI-Antworten sichtbar werden.`

/**
 * Keyword-routed mock for labor generate calls: returns a valid payload for
 * each agent contract so the full workflow dry-runs end-to-end. Anything
 * unrecognized returns a failing result, which exercises the caller's
 * fallback path (e.g. promptgen → deterministic template library).
 */
export function mockGenerate(prompt: string): Promise<ProviderResult> {
  const p = prompt.toLowerCase()
  let text: string | null = null
  if (prompt.includes('## EXEC_SUMMARY')) text = MOCK_SECTIONS_DE
  else if (prompt.includes('whyTheyWin')) {
    text = JSON.stringify({
      whyTheyWin: ['Umfassende FAQ-Struktur mit Schema.org-Markup', 'Präsenz in allen relevanten Verzeichnissen'],
      tactics: {
        content: ['Wissens-Hub mit 20+ Artikeln'],
        schema: ['FAQPage auf allen Ratgeber-Seiten'],
        directories: ['local.ch, search.ch vollständig gepflegt'],
        earned: ['Regelmässige Fachartikel'],
        entity: ['Wikidata-Eintrag vorhanden'],
      },
    })
  } else if (prompt.includes('"pages"')) {
    text = JSON.stringify({
      pages: [
        { slug: '/wissen/kosten', title: 'Was kostet die Einrichtung?', targetQuery: 'kosten einrichtung', answerCapsule: 'Die Kosten liegen zwischen CHF 250000 und 600000, abhängig von Grösse und Technik.', schemaType: 'FAQPage', priority: 1 },
        { slug: '/wissen/ablauf', title: 'Der Ablauf der Planung', targetQuery: 'ablauf planung', answerCapsule: 'Von der Analyse bis zur Übergabe dauert es 6 bis 12 Monate in fünf Phasen.', schemaType: 'Article', priority: 2 },
        { slug: '/wissen/vorschriften', title: 'Vorschriften und Bewilligungen', targetQuery: 'vorschriften bewilligung', answerCapsule: 'Strahlenschutz, Hygiene und Bau Bewilligungen sind die drei zentralen Pflichten.', schemaType: 'FAQPage', priority: 3 },
        { slug: '/wissen/anbietervergleich', title: 'Anbieter im Vergleich', targetQuery: 'anbieter vergleich', answerCapsule: 'Planer, Depots und Generalisten unterscheiden sich in Tiefe, Preis und Verantwortung.', schemaType: 'Article', priority: 4 },
      ],
    })
  } else if (prompt.includes('schemaSnippets')) {
    text = JSON.stringify({
      schemaSnippets: [{ page: '/', type: 'LocalBusiness', jsonLd: '{"@context":"https://schema.org","@type":"LocalBusiness"}' }],
      entityTasks: [{ task: 'Wikidata-Eintrag erstellen', where: 'wikidata.org', detail: 'Firma, Branche, Sitz, Website' }],
    })
  } else if (prompt.includes('directoryListings')) {
    text = JSON.stringify({
      directoryListings: [
        { directory: 'local.ch', url: 'https://www.localsearch.ch', action: 'claim', payload: { name: 'Mock Dental AG' } },
        { directory: 'Google Business Profile', url: 'https://business.google.com', action: 'create', payload: { name: 'Mock Dental AG' } },
      ],
    })
  } else if (prompt.includes('"measurement"')) {
    text = JSON.stringify({
      measurement: {
        snippetInstructions: 'Tracking-Snippet vor </body> einfügen.',
        ga4Segments: ['chatgpt.com', 'perplexity.ai'],
        weeklyKpis: ['Mention rate', 'Citation rate', 'AI referral clicks'],
      },
    })
  } else if (prompt.includes('"filename"')) {
    text = JSON.stringify({
      filename: 'mock-page.html',
      html: '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Mock Page</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script><style>body{background:#0A0A0C;color:#F4F4F5}</style></head><body><main><h1>Mock Page</h1><p>Antwort-Kapsel mit einer Zahl, einem Ort und einem Zeitrahmen für die Zitation.</p></main></body></html>',
    })
  } else if (prompt.includes('prompt library refresh')) {
    // Prompt-refresher contract: [{"text": "..."}]. Includes one brand-named
    // prompt on purpose so dry runs exercise the client-side bias guard.
    text = JSON.stringify([
      { text: 'Was kostet ein Dentaldepot in Zürich?' },
      { text: 'Beste Dentaldepots in der Schweiz im Vergleich' },
      { text: 'Mock Dental AG Erfahrungen und Bewertungen' },
      { text: 'Welches Dentaldepot liefert am schnellsten in der Deutschschweiz?' },
      { text: 'Dentalbedarf für KMU-Praxen — worauf bei der Auswahl achten?' },
      { text: 'Dentaldepot Bern — Anbietervergleich für Fachpersonen' },
      { text: 'Dentaldepot in der DACH-Region — beste Anbieter für Praxen' },
    ])
  } else if (p.includes('briefing') || p.includes('slack')) {
    text = 'Wochenbriefing (Mock): Mention-Rate stabil, Zitationen leicht gestiegen.'
  }
  if (text) return Promise.resolve({ ok: true, text, raw: { mock: true } })
  return Promise.resolve({ ok: false, error: 'mock: unrouted prompt' })
}

/** Mock Perplexity research call. */
export function mockPerplexityRun(_prompt: string): Promise<ProviderResult> {
  return Promise.resolve({
    ok: true,
    text: 'Mock-Recherche: Der Wettbewerber gewinnt durch FAQ-Struktur, Verzeichnis-Präsenz und Fachpresse.',
    citedUrls: ['https://www.kaladent.ch/faq'],
    raw: { mock: true },
  })
}

/** Mock Exa search call. */
export function mockExaSearch(_query: string): Promise<ProviderResult> {
  return Promise.resolve({
    ok: true,
    raw: [
      { url: 'https://www.kaladent.ch/wissen', title: 'Wissen — Kaladent', score: 0.9 },
      { url: 'https://www.kaladent.ch/faq', title: 'FAQ — Kaladent', score: 0.8 },
    ],
  })
}
