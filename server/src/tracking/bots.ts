/**
 * AI crawler detection — maps a User-Agent to a canonical bot name.
 *
 * Used by the /reports/* request hook in api/server.ts to log AI crawlers
 * fetching our generated landing pages (the "CDN layer": crawlers don't run
 * JS, so they can only be observed server-side). Matching is a
 * case-insensitive substring test, ordered most-specific first.
 */

const KNOWN_BOTS: [substring: string, bot: string][] = [
  ['oai-searchbot', 'OAI-SearchBot'],
  ['chatgpt-user', 'ChatGPT-User'],
  ['gptbot', 'GPTBot'],
  ['claude-user', 'Claude-User'],
  ['claudebot', 'ClaudeBot'],
  ['perplexity-user', 'Perplexity-User'],
  ['perplexitybot', 'PerplexityBot'],
  ['google-extended', 'Google-Extended'],
  ['bytespider', 'Bytespider'],
  ['meta-externalagent', 'meta-externalagent'],
]

/** Canonical bot name when the UA belongs to a known AI crawler, else null. */
export function detectBot(userAgent: string | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent.toLowerCase()
  for (const [sub, bot] of KNOWN_BOTS) {
    if (ua.includes(sub)) return bot
  }
  return null
}
