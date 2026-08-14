/**
 * AI-referral attribution — "how many users clicked the client's link after
 * an AI citation, and how many leads came from it".
 *
 * The client embeds /track.js on their site; it reports pageviews and lead
 * form submissions with the landing referrer. This module classifies the
 * referrer and aggregates the monthly per-engine funnel.
 */
import { insertReferralEvent, referralEvents } from '../db/repo.js'
import type { AiReferrer, AttributionMonth } from '../types.js'

const REFERRER_MAP: [RegExp, AiReferrer][] = [
  [/chatgpt\.com|chat\.openai\.com/i, 'chatgpt'],
  [/perplexity\.ai/i, 'perplexity'],
  [/gemini\.google\.com/i, 'gemini'],
  [/copilot\.microsoft\.com|bing\.com\/chat/i, 'copilot'],
  [/claude\.ai/i, 'claude'],
]

export function classifyReferrer(url: string): AiReferrer | null {
  if (!url) return null
  for (const [rx, name] of REFERRER_MAP) {
    if (rx.test(url)) return name
  }
  return null
}

/** Store one event from the client-site snippet. */
export function trackEvent(
  companyId: string,
  kind: 'pageview' | 'lead',
  referrerUrl: string,
  page: string,
  meta: Record<string, string> = {},
): boolean {
  const referrer = classifyReferrer(referrerUrl)
  if (!referrer) return false // not AI-sourced — ignore
  insertReferralEvent({
    companyId,
    kind,
    referrer,
    page: page.slice(0, 300),
    meta,
    at: new Date().toISOString(),
  })
  return true
}

/** Monthly funnel per company: AI clicks and leads, split by engine. */
export function attributionByMonth(companyId: string): AttributionMonth[] {
  const events = referralEvents(companyId)
  const months = new Map<string, AttributionMonth>()
  for (const ev of events) {
    const month = ev.at.slice(0, 7)
    let agg = months.get(month)
    if (!agg) {
      agg = { month, clicks: 0, leads: 0, byEngine: {} }
      months.set(month, agg)
    }
    const eng = (agg.byEngine[ev.referrer] ??= { clicks: 0, leads: 0 })
    if (ev.kind === 'pageview') {
      agg.clicks++
      eng.clicks++
    } else {
      agg.leads++
      eng.leads++
    }
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
}
