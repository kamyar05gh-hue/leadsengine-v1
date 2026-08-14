/**
 * Shared HTTP helper — JSON POST/GET over global fetch, no dependencies.
 * Port of the Python `_request`: returns { status, body } and never throws;
 * network/timeout failures come back as status -1 with an error body.
 */
import { AUDIT } from '../config.js'

export interface HttpResult {
  status: number
  /** Parsed JSON object on success, or { error: string } on HTTP/network failure. */
  body: Record<string, unknown>
}

/**
 * JSON request with timeout via AbortController (default AUDIT.callTimeoutMs).
 * Non-2xx responses return the raw text truncated to 600 chars as body.error,
 * matching the Python behaviour.
 */
export async function request(
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
  timeoutMs: number = AUDIT.callTimeoutMs,
): Promise<HttpResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { status: res.status, body: { error: text.slice(0, 600) } }
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { status: res.status, body: parsed as Record<string, unknown> }
      }
      return { status: res.status, body: { value: parsed } }
    } catch {
      return { status: res.status, body: { error: 'invalid JSON response' } }
    }
  } catch (e) {
    const err = e as Error
    const msg = controller.signal.aborted
      ? `timeout after ${timeoutMs}ms`
      : `${err.name}: ${err.message}`
    return { status: -1, body: { error: msg } }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Stringify a provider error field — some vendors return a string, others a
 * nested object (Gemini). Truncated like the Python `[:300]` slices.
 */
export function errText(body: Record<string, unknown>, max = 300): string {
  const e = body.error
  const s = typeof e === 'string' ? e : JSON.stringify(e ?? '')
  return s.slice(0, max)
}
