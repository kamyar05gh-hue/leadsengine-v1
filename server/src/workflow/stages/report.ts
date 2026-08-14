/**
 * Stage: report — narrative + PDF decks, split by PERSONA.
 *
 * Deliverable contract (one audit → two report families, each DE + EN):
 *   1. `general` — the market overview: how AI engines answer the general
 *      public's questions about the niche across all audited locations.
 *   2. `avatar`  — the same market seen through the Avatar (target audience)
 *      lens: only the prompts asked as the client's actual buyer persona.
 *
 * Each family is scored on its own record slice (competitors re-discovered
 * per slice — the avatar's competitive set can differ from the layperson's),
 * gets its own Kimi narrative, and renders through the same deck renderer.
 *
 * Legacy per-scope decks (regional/dach) can be re-enabled with
 * LE_REPORT_SCOPE_DECKS=1; the per-location duplicate decks are gone — the
 * persona decks cover all locations in one document.
 */
import { insertReport } from '../../db/repo.js'
import { writeNarrative } from '../../report/narrative.js'
import { renderScope } from '../../report/pdf.js'
import { scoreRecords } from '../../core/scoring.js'
import { discoverCompetitors } from '../../core/competitors.js'
import type {
  AuditRecord,
  Company,
  ImpactModel,
  Persona,
  ReportFile,
  ReportLang,
  ReportSections,
  Scope,
  ScopedScore,
} from '../../types.js'

const PERSONAS: Persona[] = ['general', 'avatar']

export async function runReport(
  company: Company,
  records: AuditRecord[],
  scoped: ScopedScore,
  impact: ImpactModel,
): Promise<ReportFile[]> {
  const out: ReportFile[] = []

  const store = (path: string, lang: ReportLang, scope: Scope): void => {
    const rep: Omit<ReportFile, 'id'> = {
      companyId: company.id,
      scope,
      lang,
      kind: 'pdf',
      path,
      createdAt: new Date().toISOString(),
    }
    const id = insertReport(rep)
    out.push({ id, ...rep })
  }

  // ── Persona decks: general overview + avatar lens ─────────────────────────
  // Narratives run in parallel (2 personas × 2 languages = 4 labor chains);
  // PDF rendering is local and fast, so only the LLM work is fanned out.
  const personaDecks = await Promise.all(
    PERSONAS.map(async (persona) => {
      const personaRecords = records.filter((r) => r.persona === persona)
      if (personaRecords.length === 0) return null
      const score = scoreRecords(
        personaRecords,
        company,
        discoverCompetitors(personaRecords, company),
      )
      const [de, en] = await Promise.all([
        writeNarrative(score, impact, company, 'de'),
        writeNarrative(score, impact, company, 'en'),
      ])
      return { persona, personaRecords, score, sections: { de, en } }
    }),
  )
  for (const deck of personaDecks) {
    if (!deck) continue
    const rendered = await renderScope(
      company,
      deck.personaRecords,
      deck.score,
      impact,
      deck.sections,
      'regional',
      deck.persona,
    )
    for (const r of rendered) store(r.path, r.lang, 'regional')
  }

  // ── Legacy scope decks (opt-in) ───────────────────────────────────────────
  if (process.env.LE_REPORT_SCOPE_DECKS === '1') {
    for (const scope of ['regional', 'dach'] as const) {
      const scopeRecords = records.filter((r) => r.scope === scope)
      if (scopeRecords.length === 0) continue
      const scopeScore = scoped[scope]
      const sections = {} as Record<ReportLang, ReportSections>
      for (const lang of ['de', 'en'] as const) {
        sections[lang] = await writeNarrative(scopeScore, impact, company, lang)
      }
      const rendered = await renderScope(company, scopeRecords, scopeScore, impact, sections, scope)
      for (const r of rendered) store(r.path, r.lang, scope as Scope)
    }
  }

  return out
}
