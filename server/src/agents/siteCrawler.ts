/**
 * Agent: site crawler — crawls the client's MAIN website with Playwright and
 * extracts the REAL content of every page: title, meta description, H1,
 * h2/h3 headings and the cleaned main visible text (nav/footer/script noise
 * stripped). The crawl feeds the AI-crawl-pack files (graph.jsonld,
 * website.md, llms.txt, company FAQ) so the machine-readable pack carries the
 * client's actual website content instead of thin profile-derived stubs.
 *
 * Reuses the Wix-proof Playwright navigation from designExtractor
 * (settleNavigate: domcontentloaded → best-effort networkidle → fixed render
 * settle; scrollThrough: trigger lazy IntersectionObserver sections) — fully
 * client-rendered sites (Wix/Thunderbolt, Squarespace) work.
 *
 * Crawl scope: starts at company.website, follows same-origin nav/footer/body
 * links breadth-first, up to LE_CRAWL_MAX_PAGES pages (default 12).
 *
 * Cache: reports/<companyId>/site-crawl.json, re-crawled only when missing or
 * older than LE_CRAWL_TTL_DAYS days (default 7). A failed re-crawl falls back
 * to the stale cache; with no cache at all, getSiteCrawl returns null and the
 * pack builders degrade to the profile-based behavior (logged loudly).
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { PATHS } from '../config.js'
import { scrollThrough, settleNavigate } from './designExtractor.js'
import type { Company } from '../types.js'

/** Per-page cap on extracted main text (chars). */
const TEXT_CAP = 4_000
/** Hard cap on link candidates queued per crawl (breadth guard). */
const MAX_QUEUE = 60

/** Max pages per crawl — env LE_CRAWL_MAX_PAGES, default 12. */
function maxPages(): number {
  const n = Number(process.env.LE_CRAWL_MAX_PAGES ?? 12)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 50) : 12
}

/** Cache TTL in days — env LE_CRAWL_TTL_DAYS, default 7. */
function ttlDays(): number {
  const n = Number(process.env.LE_CRAWL_TTL_DAYS ?? 7)
  return Number.isFinite(n) && n >= 0 ? n : 7
}

/** One ordered content block of a crawled page (markdown-mirror order). */
export interface CrawlBlock {
  tag: 'h2' | 'h3' | 'p'
  text: string
}

export interface CrawledPage {
  /** Real live URL on the main domain (normalized, hash/query stripped). */
  url: string
  title: string | null
  metaDescription: string | null
  h1: string | null
  /** h2/h3 heading texts in document order. */
  headings: string[]
  /** Ordered content blocks (headings + paragraphs), text budget applied. */
  blocks: CrawlBlock[]
  /** Cleaned main visible text (paragraphs joined), ≤ ~4000 chars. */
  text: string
  /** Detected language code ('de', 'en', …) or null. */
  lang: string | null
}

export interface SiteCrawl {
  companyId: string
  /** Canonical origin after redirects, e.g. 'https://www.future-media.ch'. */
  origin: string
  startUrl: string
  crawledAt: string
  /** Crawled real pages, start page first. */
  pages: CrawledPage[]
  /** External social-profile links found on the site (sameAs candidates). */
  socialLinks: string[]
}

/** Raw shape returned by the in-page probe. */
interface RawProbe {
  title: string | null
  metaDescription: string | null
  h1: string | null
  lang: string | null
  blocks: CrawlBlock[]
  navLinks: string[]
  footerLinks: string[]
  bodyLinks: string[]
  socialLinks: string[]
}

/**
 * In-page probe. Passed to page.evaluate as a STRING because this codebase
 * compiles without the DOM lib (same pattern as designExtractor). Collects
 * ordered content blocks (h2/h3/p and text-bearing list/table cells) outside
 * the header/nav/footer chrome, plus same-origin links grouped by region and
 * external social-profile links.
 */
const CRAWL_PROBE_JS = `(() => {
  const noiseSel = 'header,nav,footer,[role="navigation"],[role="banner"],[role="contentinfo"],[data-testid*="header" i],[data-testid*="footer" i],[id*="header" i],[id*="footer" i],[class*="cookie" i],[id*="cookie" i]';
  const inNoise = (el) => !!el.closest(noiseSel);
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();

  // Ordered content blocks: headings + paragraph-like text, chrome excluded.
  const blocks = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('h2,h3,p,li,blockquote,td,dt,dd')) {
    if (inNoise(el) || !visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const text = clean(el.textContent);
    if (!text) continue;
    if (tag === 'h2' || tag === 'h3') {
      if (text.length < 2 || text.length > 120) continue;
      const key = tag + '|' + text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ tag, text });
    } else {
      // paragraph-like: skip containers whose children already contribute
      if (el.querySelector('p,li,h2,h3')) continue;
      if (text.length < 25 || text.length > 1500) continue;
      const key = 'p|' + text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ tag: 'p', text });
    }
    if (blocks.length >= 400) break;
  }
  // Div-soup fallback (sites without semantic p tags): leaf div/span text.
  if (!blocks.some((b) => b.tag === 'p')) {
    for (const el of document.querySelectorAll('div,span')) {
      if (el.childElementCount > 0 || inNoise(el) || !visible(el)) continue;
      const text = clean(el.textContent);
      if (text.length < 40 || text.length > 1500) continue;
      const key = 'p|' + text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ tag: 'p', text });
      if (blocks.length >= 400) break;
    }
  }

  // Same-origin links, grouped: nav/header first, footer second, body last.
  const origin = location.origin;
  const navLinks = []; const footerLinks = []; const bodyLinks = []; const socialLinks = [];
  const socialRe = /^https?:\\/\\/(www\\.)?(linkedin\\.com|instagram\\.com|facebook\\.com|youtube\\.com|x\\.com|twitter\\.com|tiktok\\.com|pinterest\\.com|xing\\.com|vimeo\\.com)\\//i;
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!href || !/^https?:/i.test(href)) continue;
    if (socialRe.test(href)) {
      if (!socialLinks.includes(href) && socialLinks.length < 10) socialLinks.push(href);
      continue;
    }
    if (!href.startsWith(origin)) continue;
    const inHead = !!a.closest('header,nav,[data-testid*="header" i],[id*="header" i]');
    const inFoot = !!a.closest('footer,[data-testid*="footer" i],[id*="footer" i]');
    const bucket = inHead ? navLinks : inFoot ? footerLinks : bodyLinks;
    if (!bucket.includes(href) && bucket.length < 40) bucket.push(href);
  }

  const h1 = document.querySelector('h1');
  const meta = document.querySelector('meta[name="description"]');
  return {
    title: clean(document.title) || null,
    metaDescription: meta ? clean(meta.getAttribute('content')) || null : null,
    h1: h1 ? clean(h1.textContent) || null : null,
    lang: ((document.documentElement.getAttribute('lang') || '').split('-')[0] || '').toLowerCase() || null,
    blocks,
    navLinks, footerLinks, bodyLinks, socialLinks,
  };
})()`

/** File extensions that are never content pages. */
const BINARY_RE = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|rar|mp3|mp4|webm|mov|avi|docx?|xlsx?|pptx?|css|js|json|xml|txt)$/i

/**
 * Normalize a link into a crawlable same-origin page URL: hash + query
 * stripped, trailing slash trimmed (root stays 'origin/'), binaries and
 * off-origin links → null.
 */
function normalizeUrl(href: string, origin: string): string | null {
  try {
    const u = new URL(href)
    if (u.origin !== origin) return null
    const p = u.pathname.replace(/\/+$/, '')
    if (BINARY_RE.test(p)) return null
    return p === '' ? `${origin}/` : `${origin}${p}`
  } catch {
    return null
  }
}

/** Detect the page language: html[lang] first, stopword heuristic second. */
function detectLang(htmlLang: string | null, text: string): string | null {
  if (htmlLang) return htmlLang
  const t = ` ${text.toLowerCase().replace(/[^a-zäöüéèà\s]/g, ' ')} `
  const de = (t.match(/ (und|der|die|das|nicht|mit|für|wir|sie|ihre?) /g) ?? []).length
  const en = (t.match(/ (the|and|with|for|our|we|your|are) /g) ?? []).length
  if (de === 0 && en === 0) return null
  return de >= en ? 'de' : 'en'
}

/**
 * Apply the per-page text budget: keep blocks in order until the paragraph
 * text reaches TEXT_CAP chars (headings ride along for free — they are the
 * page's skeleton and tiny). Returns the trimmed blocks + the joined text.
 */
function budgetBlocks(blocks: CrawlBlock[]): { blocks: CrawlBlock[]; text: string } {
  const kept: CrawlBlock[] = []
  let used = 0
  for (const b of blocks) {
    if (b.tag === 'p') {
      if (used >= TEXT_CAP) continue
      const remaining = TEXT_CAP - used
      const text = b.text.length > remaining ? `${b.text.slice(0, Math.max(0, remaining - 1)).trimEnd()}…` : b.text
      if (text.length < 2) continue
      kept.push({ tag: 'p', text })
      used += text.length
    } else {
      kept.push(b)
    }
  }
  // Drop trailing headings with no paragraph after them (skeleton noise).
  while (kept.length > 0 && kept[kept.length - 1]?.tag !== 'p') kept.pop()
  const text = kept
    .filter((b) => b.tag === 'p')
    .map((b) => b.text)
    .join('\n')
  return { blocks: kept, text }
}

/** Absolute path of the crawl cache file for one company. */
export function crawlCacheFile(companyId: string): string {
  const safe = companyId.replace(/[^a-z0-9_-]/gi, '_')
  return path.join(PATHS.reports, safe, 'site-crawl.json')
}

/** Loose shape check for a cached crawl. */
function isSiteCrawl(v: unknown): v is SiteCrawl {
  return (
    typeof v === 'object' &&
    v !== null &&
    'origin' in v &&
    'crawledAt' in v &&
    'pages' in v &&
    Array.isArray((v as SiteCrawl).pages)
  )
}

function readCrawlCache(companyId: string): SiteCrawl | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(crawlCacheFile(companyId), 'utf8'))
    return isSiteCrawl(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeCrawlCache(crawl: SiteCrawl): void {
  try {
    const file = crawlCacheFile(crawl.companyId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(crawl, null, 2), 'utf8')
  } catch (err) {
    console.warn('[siteCrawler] could not write crawl cache:', err instanceof Error ? err.message : err)
  }
}

/** True when the cached crawl is younger than the TTL and non-empty. */
function isFresh(crawl: SiteCrawl): boolean {
  if (crawl.pages.length === 0) return false
  const age = Date.now() - Date.parse(crawl.crawledAt)
  return Number.isFinite(age) && age < ttlDays() * 24 * 60 * 60 * 1000
}

/**
 * Crawl the client's main site (no cache involvement). Throws when the start
 * page cannot be loaded; individual inner-page failures are skipped.
 */
export async function crawlSite(company: Company): Promise<SiteCrawl> {
  const limit = maxPages()
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

    // Start page — its post-redirect origin is the canonical origin.
    await settleNavigate(page, company.website)
    const origin = new URL(page.url()).origin

    const visited = new Set<string>()
    const queue: string[] = [normalizeUrl(page.url(), origin) ?? `${origin}/`]
    const pages: CrawledPage[] = []
    const socialLinks: string[] = []
    let first = true

    while (queue.length > 0 && pages.length < limit) {
      const url = queue.shift() as string
      if (visited.has(url)) continue
      visited.add(url)

      try {
        if (!first) await settleNavigate(page, url)
        first = false
        const landed = normalizeUrl(page.url(), origin)
        if (!landed) continue // redirected off-origin
        if (landed !== url) {
          if (visited.has(landed)) continue
          visited.add(landed)
        }
        await scrollThrough(page)
        const raw = (await page.evaluate(CRAWL_PROBE_JS)) as RawProbe

        const { blocks, text } = budgetBlocks(raw.blocks)
        pages.push({
          url: landed,
          title: raw.title,
          metaDescription: raw.metaDescription,
          h1: raw.h1,
          headings: blocks.filter((b) => b.tag !== 'p').map((b) => b.text),
          blocks,
          text,
          lang: detectLang(raw.lang, text),
        })
        for (const s of raw.socialLinks) if (!socialLinks.includes(s)) socialLinks.push(s)

        // Enqueue nav links first, then footer, then body links.
        for (const href of [...raw.navLinks, ...raw.footerLinks, ...raw.bodyLinks]) {
          if (queue.length >= MAX_QUEUE) break
          const next = normalizeUrl(href, origin)
          if (next && !visited.has(next) && !queue.includes(next)) queue.push(next)
        }
      } catch (err) {
        console.warn(
          `[siteCrawler] ${company.id}: page failed, skipping ${url}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }

    if (pages.length === 0) throw new Error('crawl yielded zero pages')
    return {
      companyId: company.id,
      origin,
      startUrl: company.website,
      crawledAt: new Date().toISOString(),
      pages,
      socialLinks,
    }
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

/**
 * The crawl the pack builders consume: fresh cache when younger than
 * LE_CRAWL_TTL_DAYS, otherwise a new crawl (persisted). Degrades in order:
 * fresh cache → new crawl → STALE cache → null (loud log at every fallback);
 * on null the callers keep the profile-based behavior.
 */
export async function getSiteCrawl(company: Company): Promise<SiteCrawl | null> {
  const cached = readCrawlCache(company.id)
  if (cached && isFresh(cached)) {
    console.log(
      `[siteCrawler] ${company.id}: using cached crawl (${cached.pages.length} pages, ${cached.crawledAt.slice(0, 10)})`,
    )
    return cached
  }

  try {
    console.log(`[siteCrawler] ${company.id}: crawling ${company.website} (max ${maxPages()} pages)`)
    const crawl = await crawlSite(company)
    writeCrawlCache(crawl)
    console.log(
      `[siteCrawler] ${company.id}: crawled ${crawl.pages.length} pages from ${crawl.origin}`,
    )
    return crawl
  } catch (err) {
    console.error(
      `[siteCrawler] ${company.id}: CRAWL FAILED for ${company.website} — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
    if (cached && cached.pages.length > 0) {
      console.error(
        `[siteCrawler] ${company.id}: falling back to STALE crawl cache from ${cached.crawledAt}`,
      )
      return cached
    }
    console.error(
      `[siteCrawler] ${company.id}: no crawl available — pack files degrade to profile-derived content`,
    )
    return null
  }
}
