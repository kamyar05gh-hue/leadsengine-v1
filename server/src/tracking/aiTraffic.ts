/**
 * AI-traffic summary — the data behind the dashboard's "AI Traffic" section.
 *
 * Combines the two ways AI visibility turns into visits:
 * - bot_visits: AI crawlers fetching the hosted/generated pages (server-side
 *   log, see tracking/bots.ts and the /reports/* hook in api/server.ts)
 * - referral_events: humans clicking an AI citation through to the client
 *   site (client-side snippet, see tracking/referrals.ts)
 */
import { botVisitSummary, referralEvents } from '../db/repo.js'
import type { BotVisitSummary } from '../types.js'

/** Referrers we treat as AI engines (stored, already-classified values). */
const KNOWN_AI_REFERRERS = new Set(['chatgpt', 'perplexity', 'gemini', 'copilot', 'claude'])
/** Catch-all for raw referrers that slipped through unclassified. */
const AI_DOMAIN_RX = /openai|perplexity|google|bing|anthropic/i

export interface AiTrafficSummary {
  botVisits: BotVisitSummary
  humanReferrals: {
    total: number
    byReferrer: { referrer: string; count: number }[]
    topPages: { page: string; count: number }[]
  }
}

export function aiTrafficSummary(companyId: string): AiTrafficSummary {
  const pageviews = referralEvents(companyId).filter(
    (ev) =>
      ev.kind === 'pageview' &&
      (KNOWN_AI_REFERRERS.has(ev.referrer) || AI_DOMAIN_RX.test(ev.referrer)),
  )

  const byReferrer = new Map<string, number>()
  const byPage = new Map<string, number>()
  for (const ev of pageviews) {
    byReferrer.set(ev.referrer, (byReferrer.get(ev.referrer) ?? 0) + 1)
    byPage.set(ev.page, (byPage.get(ev.page) ?? 0) + 1)
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  return {
    botVisits: botVisitSummary(companyId),
    humanReferrals: {
      total: pageviews.length,
      byReferrer: sorted(byReferrer).map(([referrer, count]) => ({ referrer, count })),
      topPages: sorted(byPage)
        .slice(0, 20)
        .map(([page, count]) => ({ page, count })),
    },
  }
}
