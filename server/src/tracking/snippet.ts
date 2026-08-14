/**
 * The client-site tracking snippet, served at GET /track.js?company=<id>.
 *
 * Vanilla JS, no dependencies, ~1 KB: captures the AI referrer of the
 * landing visit (persisted in localStorage so later sessions still
 * attribute), posts a pageview, and auto-hooks form submissions as leads.
 *
 * Note: this snippet only sees HUMAN referrals — AI crawlers don't execute
 * JS. Client sites that want crawler visibility must forward their server
 * logs (or wire a CDN log push, e.g. Cloudflare/Vercel) to
 * POST /api/track/bot; pages hosted by us under /reports/ are logged
 * automatically by the server-side bot hook.
 */
import { API_PORT } from '../config.js'

export function trackingSnippet(companyId: string, apiBase?: string): string {
  const base = apiBase ?? `http://localhost:${API_PORT}`
  return `(function () {
  var COMPANY = ${JSON.stringify(companyId)};
  var API = ${JSON.stringify(base)};
  var KEY = 'le_referrer';
  var AI = /chatgpt\\.com|chat\\.openai\\.com|perplexity\\.ai|gemini\\.google\\.com|copilot\\.microsoft\\.com|claude\\.ai/i;
  try {
    var ref = document.referrer || '';
    if (AI.test(ref)) localStorage.setItem(KEY, ref);
    var stored = localStorage.getItem(KEY) || ref;
    if (!AI.test(stored)) return;
    function send(kind, meta) {
      fetch(API + '/api/track/' + kind, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: COMPANY,
          referrer: stored,
          page: location.pathname,
          meta: meta || {}
        }),
        keepalive: true
      }).catch(function () {});
    }
    send('pageview');
    document.addEventListener('submit', function (ev) {
      var form = ev.target;
      send('lead', { form: form && (form.id || form.name || 'form') });
    }, true);
  } catch (e) { /* tracking must never break the host site */ }
})();
`
}
