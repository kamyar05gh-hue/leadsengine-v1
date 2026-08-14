/**
 * Agent: answer shape analyzer — which answer FORMATS earn citations.
 *
 * For every ok audit record we classify the AI answer's shape with simple
 * deterministic detectors (no model calls):
 *  - list:    markdown bullets or numbered lists
 *  - table:   markdown pipe tables
 *  - numbers: statistics — percentages, currency amounts, or larger figures
 *  - length:  character count
 *
 * Answers are then grouped by their format signature (e.g. "list+numbers",
 * "table", "prose") and each group is ranked by average citations per
 * answer — evidence for which content formats the engines reward, which
 * directly informs what the client should publish.
 *
 * Entry points mirror evidenceExtractor: analyzeAnswerShapes(id) for the
 * API, analyzeAnswerShapesFromRecords(records, company) for the report.
 */
import type {
  AnswerShapeAnalysis,
  AnswerShapeGroup,
  AuditRecord,
  Company,
} from '../types.js'
import { allAuditRecords, getCompany } from '../db/repo.js'
import { firstIdx, round1 } from '../core/scoring.js'
import { brandCited } from '../core/citations.js'

/** Markdown bullet ("- ", "* ", "• ") or numbered ("1. ", "2) ") list item. */
const LIST_RX = /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/m
/** Markdown pipe-table row — a line starting and ending with '|'. */
const TABLE_RX = /^\s*\|.*\|\s*$/m
/** Statistics: % / currency figures, or any number with 2+ digits. */
const NUMBERS_RX = /\d[\d.,' ]*\s*(?:%|chf|fr\.?|eur|€|\$)|\b\d{2,}\b/i

interface Shape {
  hasList: boolean
  hasTable: boolean
  hasNumbers: boolean
  chars: number
}

function detectShape(text: string): Shape {
  return {
    hasList: LIST_RX.test(text),
    hasTable: TABLE_RX.test(text),
    hasNumbers: NUMBERS_RX.test(text),
    chars: text.length,
  }
}

/** Format signature: active features joined with '+', or 'prose'. */
function signatureOf(s: Shape): string {
  const parts: string[] = []
  if (s.hasTable) parts.push('table')
  if (s.hasList) parts.push('list')
  if (s.hasNumbers) parts.push('numbers')
  return parts.length > 0 ? parts.join('+') : 'prose'
}

/**
 * Build the analysis from an in-memory record set. Mention/citation flags
 * use the same derivation as the scorer so groups reconcile with the
 * headline metrics.
 */
export function analyzeAnswerShapesFromRecords(
  records: AuditRecord[],
  company: Company,
): AnswerShapeAnalysis {
  const ok = records.filter((r) => r.ok && r.text)

  interface GroupAcc {
    answers: number
    chars: number
    citedUrls: number
    clientCited: number
    clientMentioned: number
  }
  const groups = new Map<string, GroupAcc>()
  let lists = 0
  let tables = 0
  let numbers = 0
  let totalChars = 0

  for (const r of ok) {
    const text = r.text ?? ''
    const shape = detectShape(text)
    if (shape.hasList) lists += 1
    if (shape.hasTable) tables += 1
    if (shape.hasNumbers) numbers += 1
    totalChars += shape.chars

    const sig = signatureOf(shape)
    const g = groups.get(sig) ?? {
      answers: 0,
      chars: 0,
      citedUrls: 0,
      clientCited: 0,
      clientMentioned: 0,
    }
    g.answers += 1
    g.chars += shape.chars
    g.citedUrls += r.citedUrls.length
    if (brandCited(r.citedUrls, company.domainHints)) g.clientCited += 1
    if (firstIdx(text, company.aliases) !== null) g.clientMentioned += 1
    groups.set(sig, g)
  }

  const n = ok.length
  const groupList: AnswerShapeGroup[] = [...groups.entries()]
    .map(([signature, g]) => ({
      signature,
      answers: g.answers,
      avgChars: Math.round(g.chars / g.answers),
      avgCitedUrls: round1(g.citedUrls / g.answers),
      citationRate: round1((100 * g.clientCited) / g.answers),
      mentionRate: round1((100 * g.clientMentioned) / g.answers),
    }))
    // which shapes win: most citations per answer first, then most answers
    .sort((a, b) => b.avgCitedUrls - a.avgCitedUrls || b.answers - a.answers)

  return {
    companyId: company.id,
    generatedAt: new Date().toISOString(),
    answersAnalyzed: n,
    prevalence: {
      lists: n > 0 ? round1((100 * lists) / n) : 0,
      tables: n > 0 ? round1((100 * tables) / n) : 0,
      numbers: n > 0 ? round1((100 * numbers) / n) : 0,
      avgChars: n > 0 ? Math.round(totalChars / n) : 0,
    },
    groups: groupList,
  }
}

/** API entry point: load the company + all stored records, then analyze. */
export function analyzeAnswerShapes(companyId: string): AnswerShapeAnalysis | null {
  const company = getCompany(companyId)
  if (!company) return null
  return analyzeAnswerShapesFromRecords(allAuditRecords(companyId), company)
}
