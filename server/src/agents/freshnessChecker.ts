/**
 * freshnessChecker.ts — weekly content-freshness check-up for generated
 * landing pages (reports with kind 'page').
 *
 * Pure filesystem heuristics, no network, no LLM: each page's HTML is scanned
 * for date hints (JSON-LD datePublished/dateModified, <time datetime>,
 * "Stand:"/"Updated:"/"Aktualisiert" labels) and for links back to the
 * company's main site. Findings land in freshness_checks — one row per
 * (path, reason) for stale pages, one 'ok' row for clean ones — so the
 * /freshness endpoint reads the latest run without re-scanning.
 */
import fs from 'node:fs'

import { getCompany, insertFreshnessCheck, listReports } from '../db/repo.js'
import type { FreshnessReason } from '../types.js'

export interface StalePage {
  path: string
  reason: Exclude<FreshnessReason, 'ok'>
  detail: string
}

export interface FreshnessResult {
  checked: number
  stale: StalePage[]
}

/** Pages with no date hint newer than this count as stale. */
const STALE_DAYS = 90

function hostnameOf(url: string): string | null {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** All parseable date hints in the HTML; invalid dates are dropped. */
function extractDates(html: string): Date[] {
  const found: Date[] = []
  const push = (raw: string | undefined) => {
    if (!raw) return
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) found.push(d)
  }
  // JSON-LD (and any inline JSON) date fields — dateModified wins by being
  // collected alongside; the max is taken at the end either way.
  for (const m of html.matchAll(/"date(?:Modified|Published)"\s*:\s*"([^"]+)"/gi)) push(m[1])
  for (const m of html.matchAll(/<time[^>]+datetime=["']([^"']+)["']/gi)) push(m[1])
  // Human-readable labels: Stand: 12.05.2026 / Aktualisiert am 2026-05-12 / Updated: May 12, 2026
  for (const m of html.matchAll(
    /(?:Stand|Aktualisiert(?:\s+am)?|Updated(?:\s+on)?)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
  )) {
    const raw = m[1] ?? ''
    // DD.MM.YYYY → ISO so Date parses it unambiguously.
    const de = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    push(de ? `${de[3]}-${de[2]!.padStart(2, '0')}-${de[1]!.padStart(2, '0')}` : raw)
  }
  return found
}

/** Links (href/src) pointing at the company's main-site hostname. */
function countMainLinks(html: string, hostname: string): number {
  const rx = new RegExp(
    `(?:href|src)=["']https?://(?:www\\.)?${hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/"']`,
    'gi',
  )
  return [...html.matchAll(rx)].length
}

/**
 * Scan the company's generated landing pages and persist the run.
 * Never throws on missing files or unparseable HTML — those pages are
 * skipped (not counted as checked).
 */
export async function checkContentFreshness(companyId: string): Promise<FreshnessResult> {
  const company = getCompany(companyId)
  if (!company) throw new Error(`[freshness] unknown company: ${companyId}`)

  // listReports is id-DESC, so the first occurrence per path is the newest.
  const seen = new Set<string>()
  const pages = listReports(companyId).filter((r) => {
    if (r.kind !== 'page' || seen.has(r.path)) return false
    if (!r.path.toLowerCase().endsWith('.html')) return false // robots.txt / llms.txt are not content pages
    seen.add(r.path)
    return true
  })

  const host = hostnameOf(company.website)
  const checkedAt = new Date().toISOString()
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
  const stale: StalePage[] = []
  let checked = 0

  for (const page of pages) {
    if (!fs.existsSync(page.path)) continue
    let html: string
    try {
      html = fs.readFileSync(page.path, 'utf8')
    } catch {
      continue
    }
    checked += 1

    const findings: StalePage[] = []
    const dates = extractDates(html)
    const latest = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null
    if (!latest) {
      findings.push({ path: page.path, reason: 'undated', detail: 'no date hint found in the HTML' })
    } else if (latest.getTime() < cutoff) {
      const days = Math.floor((Date.now() - latest.getTime()) / (24 * 60 * 60 * 1000))
      findings.push({
        path: page.path,
        reason: 'stale',
        detail: `last updated ${latest.toISOString().slice(0, 10)} (${days} days ago)`,
      })
    }
    if (host) {
      const links = countMainLinks(html, host)
      if (links === 0) {
        findings.push({ path: page.path, reason: 'no-main-links', detail: `no links to ${host}` })
      }
    }

    if (findings.length === 0) {
      insertFreshnessCheck({
        companyId,
        path: page.path,
        reason: 'ok',
        detail: latest ? `fresh — updated ${latest.toISOString().slice(0, 10)}` : 'fresh',
        checkedAt,
      })
    } else {
      for (const f of findings) {
        insertFreshnessCheck({ companyId, path: f.path, reason: f.reason, detail: f.detail, checkedAt })
        stale.push(f)
      }
    }
  }

  return { checked, stale }
}
