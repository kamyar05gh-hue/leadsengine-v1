/**
 * Agent: page-type decider — decides WHAT KIND of page a content gap needs
 * before any content is generated. Pure function, exported for tests.
 *
 * One page = one content type, never mixed. Decision order:
 *   1. the gap's recommendedFormat wins (it comes from the gap analysis)
 *   2. the dominant format among the winning competitor pages
 *   3. 'guide' as the last-resort default
 */
import type { CompetitorPage, ContentGapFormat } from '../types.js'

/** The five page types a landing page can take (mirrors ContentGapFormat). */
export type PageType = ContentGapFormat

const VALID_TYPES: PageType[] = ['faq', 'comparison', 'listicle', 'guide', 'table']

/** Tie-break order — the most structured shape wins when counts are equal. */
const TYPE_PRECEDENCE: PageType[] = ['faq', 'comparison', 'table', 'listicle', 'guide']

/** Map a competitor page's answer format onto a page type. */
function typeFromCompetitorPage(page: CompetitorPage): PageType {
  switch (page.answerFormat) {
    case 'faq':
      return 'faq'
    case 'table':
      // a winning page built around a Vergleichstabelle maps to comparison
      return page.hasComparisonTable ? 'comparison' : 'table'
    case 'list':
      return 'listicle'
    default:
      return 'guide'
  }
}

/**
 * Decide the single page type for a gap. `gap` only needs the
 * recommendedFormat field, so callers with a PageSpec instead of a
 * ContentGap can pass `{ recommendedFormat: null }`.
 */
export function decidePageType(
  gap: { recommendedFormat?: ContentGapFormat | null },
  competitorPages: CompetitorPage[],
): PageType {
  if (gap.recommendedFormat && VALID_TYPES.includes(gap.recommendedFormat)) {
    return gap.recommendedFormat
  }

  const counts = new Map<PageType, number>()
  for (const page of competitorPages) {
    const t = typeFromCompetitorPage(page)
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  let best: PageType | null = null
  let bestCount = 0
  for (const t of TYPE_PRECEDENCE) {
    const n = counts.get(t) ?? 0
    if (n > bestCount) {
      best = t
      bestCount = n
    }
  }
  return best ?? 'guide'
}
