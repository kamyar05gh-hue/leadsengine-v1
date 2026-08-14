/**
 * Agent: design extractor — screenshots a live website with Playwright at
 * the three breakpoints that matter (desktop/tablet/mobile), capturing the
 * hero, header, footer, and one inner page. The PNGs feed visionAnalyzer.ts,
 * which turns them into design tokens.
 *
 * Output layout: server/assets/screenshots/{domain}/{viewport}-{section}.png
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { PATHS } from '../config.js'
import type { SiteLink, SiteStructure } from './siteStructure.js'

export interface ScreenshotSet {
  domain: string
  dir: string
  /** Absolute paths of every screenshot, in capture order. */
  paths: string[]
}

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const

type ViewportName = keyof typeof VIEWPORTS

const NAV_TIMEOUT_MS = 45_000
/** Give client-side rendering / lazy hero media a moment to settle. */
const SETTLE_MS = 1_500
/**
 * Extra settle after networkidle for fully client-rendered sites
 * (Wix/Thunderbolt renders everything in JS well after networkidle).
 */
const RENDER_SETTLE_MS = 4_000

/** 'https://www.future-media.ch/path' → 'future-media.ch' (filesystem-safe). */
function domainOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_')
}

async function shot(page: Page, file: string, paths: string[]): Promise<void> {
  await page.screenshot({ path: file })
  paths.push(file)
}

/**
 * Navigate and wait for a client-rendered site to settle. Sites with video
 * heroes / streaming beacons may NEVER reach networkidle, so networkidle is
 * best-effort on top of domcontentloaded + a fixed render settle.
 * Exported — siteCrawler reuses the exact same Wix-proof navigation.
 */
export async function settleNavigate(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  } catch (err) {
    // a timed-out goto may still have committed the navigation
    if (!page.url().startsWith('http')) throw err
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForTimeout(RENDER_SETTLE_MS)
}

/**
 * Scroll through the whole document to trigger lazy rendering / IntersectionObserver
 * content, then return to the top. Client-rendered sites (Wix) paint most
 * sections only once they enter the viewport.
 * Exported — siteCrawler reuses it to surface lazy-rendered content.
 */
export async function scrollThrough(page: Page): Promise<void> {
  await page
    .evaluate(
      `(async () => {
        const h = document.body.scrollHeight;
        for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
        window.scrollTo(0, 0);
      })()`,
    )
    .catch(() => undefined)
  await page.waitForTimeout(1_000)
}

/** Hero (top of page), header (top strip), mid section, footer (bottom of page). */
async function captureSections(
  page: Page,
  dir: string,
  viewport: ViewportName,
  paths: string[],
): Promise<void> {
  const { width } = VIEWPORTS[viewport]
  await page.evaluate('window.scrollTo(0, 0)')
  await page.waitForTimeout(SETTLE_MS)

  await shot(page, path.join(dir, `${viewport}-hero.png`), paths)
  await page.screenshot({
    path: path.join(dir, `${viewport}-header.png`),
    clip: { x: 0, y: 0, width, height: 140 },
  })
  paths.push(path.join(dir, `${viewport}-header.png`))

  await page.evaluate('window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.45))')
  await page.waitForTimeout(SETTLE_MS)
  await shot(page, path.join(dir, `${viewport}-mid.png`), paths)

  await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
  await page.waitForTimeout(SETTLE_MS)
  await shot(page, path.join(dir, `${viewport}-footer.png`), paths)
}

/** First same-origin link that is not the home page — used as the inner page. */
async function findInnerPageUrl(page: Page, origin: string): Promise<string | null> {
  const hrefs = await page.$$eval('a[href]', (els) =>
    els.map((a) => (a as unknown as { href: string }).href).filter(Boolean),
  )
  for (const href of hrefs) {
    try {
      const u = new URL(href)
      const path = u.pathname.replace(/\/+$/, '')
      if (u.origin === origin && path !== '' && !u.hash) return u.toString()
    } catch {
      // ignore malformed hrefs
    }
  }
  return null
}

/**
 * Screenshot `url` at desktop/tablet/mobile and return the PNG paths.
 * Throws if the page itself cannot be loaded — callers (API route) convert
 * that into a 502; individual section/inner-page failures are skipped so a
 * broken footer or missing inner link never sinks the whole extraction.
 */
export async function extractDesignSystem(url: string): Promise<ScreenshotSet> {
  const domain = domainOf(url)
  const dir = path.join(PATHS.root, 'assets', 'screenshots', domain)
  fs.mkdirSync(dir, { recursive: true })

  const paths: string[] = []
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await settleNavigate(page, url)
    await scrollThrough(page)
    const origin = new URL(page.url()).origin

    // Inner page URL discovered once, from the desktop render of the home page.
    const innerUrl = await findInnerPageUrl(page, origin).catch(() => null)

    for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
      await page.setViewportSize(VIEWPORTS[viewport])
      try {
        await captureSections(page, dir, viewport, paths)
      } catch {
        // keep going — a partial set still beats none
      }
    }

    if (innerUrl) {
      try {
        await page.setViewportSize(VIEWPORTS.desktop)
        await settleNavigate(page, innerUrl)
        await shot(page, path.join(dir, 'desktop-inner.png'), paths)
      } catch {
        // inner page is best-effort
      }
    }
  } finally {
    await browser?.close().catch(() => undefined)
  }

  if (paths.length === 0) throw new Error(`no screenshots captured for ${url}`)
  return { domain, dir, paths }
}

// ─── Rendered-DOM computed-style extraction ─────────────────────────────────
//
// Client-rendered sites (Wix/Thunderbolt, Squarespace, SPA builders) return an
// empty shell to curl — the ONLY reliable design source is the rendered DOM.
// extractRenderedDesign() loads the page in Playwright, waits for client-side
// rendering, scrolls through to trigger lazy sections, and reads COMPUTED
// styles: exact colors, exact font stacks, exact button styles, the dominant
// palette ranked by painted area, the logo URL and section backgrounds.
// These measured facts always override vision-model guesses.

/** Computed style of one representative element. */
export interface StyleProbe {
  fontFamily: string
  fontSize: string
  fontWeight: string
  letterSpacing: string
  color: string
  backgroundColor: string
  borderRadius: string
  textTransform: string
  padding: string
  lineHeight: string
  textAlign: string
}

/** A real button on the live site, measured at its painted element + text node. */
export interface ButtonProbe {
  text: string
  href: string | null
  background: string
  textColor: string
  border: string
  borderRadius: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  letterSpacing: string
  textTransform: string
  height: number
  /** True when the button sits in the header strip (top 150px). */
  inHeader: boolean
}

export interface PaletteEntry {
  color: string
  /** Total painted area (px²) — the ranking signal. */
  area: number
}

/** Everything measured from the rendered DOM of the client's live site. */
export interface RenderedDesign {
  url: string
  extractedAt: string
  /** Effective full-page background (first opaque background behind content). */
  pageBackground: string
  elements: {
    body: StyleProbe | null
    h1: StyleProbe | null
    h2: StyleProbe | null
    h3: StyleProbe | null
    p: StyleProbe | null
    a: StyleProbe | null
    nav: StyleProbe | null
    footer: StyleProbe | null
  }
  /** First family of the dominant heading font stack. */
  headingFont: string | null
  /** Full heading font stack as computed. */
  headingFontStack: string | null
  bodyFont: string | null
  bodyFontStack: string | null
  /** Background colors ranked by painted area. */
  bgPalette: PaletteEntry[]
  /** Text colors ranked by painted area. */
  textPalette: PaletteEntry[]
  buttons: ButtonProbe[]
  /** The solid/filled button style (content CTAs). */
  primaryButton: ButtonProbe | null
  /** The outlined/transparent pill style, when the site has one. */
  ghostButton: ButtonProbe | null
  /** The button found in the header strip (site's own header CTA). */
  headerButton: ButtonProbe | null
  logo: { src: string; alt: string; width: number; height: number } | null
  /** Effective background bands sampled down the page (section alternation). */
  sectionBackgrounds: string[]
  /** Font families actually loaded via @font-face (family + weight). */
  fontsLoaded: string[]
  siteTitle: string | null
  metaDescription: string | null
  navLabels: string[]
}

/**
 * In-page probe. Passed to page.evaluate as a STRING because this codebase
 * compiles without the DOM lib. Must stay a self-contained IIFE.
 */
const RENDER_PROBE_JS = `(() => {
  const pick = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing, color: s.color, backgroundColor: s.backgroundColor,
      borderRadius: s.borderRadius, textTransform: s.textTransform, padding: s.padding,
      lineHeight: s.lineHeight, textAlign: s.textAlign,
    };
  };
  const transparent = (c) => !c || c === 'transparent' || /rgba\\([^)]+, 0\\)$/.test(c);
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };

  // Effective page background: body/html, else the largest opaque block.
  let pageBg = getComputedStyle(document.body).backgroundColor;
  if (transparent(pageBg)) pageBg = getComputedStyle(document.documentElement).backgroundColor;

  // Palette ranked by painted area.
  const bgArea = new Map(); const textArea = new Map();
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!r || r.width < 4 || r.height < 4) continue;
    const s = getComputedStyle(el);
    const area = Math.min(r.width * r.height, 3e6);
    if (!transparent(s.backgroundColor))
      bgArea.set(s.backgroundColor, (bgArea.get(s.backgroundColor) || 0) + area);
    if (el.childElementCount === 0 && (el.textContent || '').trim())
      textArea.set(s.color, (textArea.get(s.color) || 0) + area);
  }
  const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([color, area]) => ({ color, area: Math.round(area) }));
  const bgPalette = rank(bgArea); const textPalette = rank(textArea);
  if (transparent(pageBg) && bgPalette.length > 0) pageBg = bgPalette[0].color;

  // Representative text elements.
  const h1 = document.querySelector('h1');
  const h2s = [...document.querySelectorAll('h2')].filter(visible);
  const h3 = [...document.querySelectorAll('h3')].find(visible) || null;
  const pEls = [...document.querySelectorAll('p')].filter((e) => visible(e) && (e.textContent || '').trim().length > 40).slice(0, 25);
  // Dominant paragraph font: most common family among samples.
  const famCount = new Map(); let pProbe = null;
  for (const e of pEls) {
    const f = getComputedStyle(e).fontFamily;
    famCount.set(f, (famCount.get(f) || 0) + 1);
  }
  let bestFam = null, bestN = 0;
  for (const [f, n] of famCount) if (n > bestN) { bestFam = f; bestN = n; }
  if (bestFam) pProbe = pick(pEls.find((e) => getComputedStyle(e).fontFamily === bestFam));
  else if (pEls.length > 0) pProbe = pick(pEls[0]);
  const aEl = [...document.querySelectorAll('main a, section a, a')].find((e) => visible(e) && (e.textContent || '').trim().length > 2) || null;
  const navEl = document.querySelector('header, nav, [data-testid*="header" i]');
  const footEl = document.querySelector('footer, [data-testid*="footer" i]');

  // Buttons: find the painted element (bg or border) and the deepest text node.
  const buttons = [];
  for (const el of document.querySelectorAll('a, button')) {
    const r = el.getBoundingClientRect();
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 45 || r.width < 60 || r.height < 24 || r.height > 90) continue;
    let painted = null;
    for (const n of [el, ...el.querySelectorAll('*')]) {
      const s = getComputedStyle(n);
      const hasBg = !transparent(s.backgroundColor);
      const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none';
      if (hasBg || hasBorder) { painted = { s, hasBg }; break; }
    }
    if (!painted) continue;
    let textEl = el;
    const walk = (n) => { for (const c of n.children) walk(c); if ((n.textContent || '').trim() && n.children.length === 0) textEl = n; };
    walk(el);
    const ts = getComputedStyle(textEl);
    buttons.push({
      text: txt, href: el.href || null,
      background: painted.hasBg ? painted.s.backgroundColor : 'transparent',
      textColor: ts.color, border: painted.s.border, borderRadius: painted.s.borderRadius,
      fontFamily: ts.fontFamily, fontSize: ts.fontSize, fontWeight: ts.fontWeight,
      letterSpacing: ts.letterSpacing, textTransform: ts.textTransform,
      height: Math.round(r.height), inHeader: r.top < 150,
    });
    if (buttons.length >= 16) break;
  }

  // Logo: first reasonably-sized image in the header strip.
  let logo = null;
  const logoCandidates = [
    ...document.querySelectorAll('header img, nav img, [data-testid*="header" i] img'),
    ...document.querySelectorAll('img'),
  ];
  for (const img of logoCandidates) {
    const r = img.getBoundingClientRect();
    if (r.top < 200 && r.width >= 30 && r.width <= 500 && r.height >= 12 && r.height <= 180 && img.src) {
      logo = { src: img.src, alt: img.alt || '', width: Math.round(r.width), height: Math.round(r.height) };
      break;
    }
  }

  // Section background bands: effective opaque background at sampled depths.
  const doc = document.body.scrollHeight;
  const secBgs = [];
  for (const frac of [0.08, 0.25, 0.45, 0.65, 0.85, 0.97]) {
    const y = Math.floor(doc * frac);
    let band = pageBg;
    let best = null;
    for (const el of document.querySelectorAll('section, main > div, main > div > div, footer, header')) {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY;
      if (top <= y && top + r.height >= y && r.height >= 120) {
        const s = getComputedStyle(el);
        if (!transparent(s.backgroundColor) && (!best || r.height < best.h)) best = { c: s.backgroundColor, h: r.height };
      }
    }
    if (best) band = best.c;
    secBgs.push(band);
  }

  // Loaded font faces.
  const fonts = new Set();
  try { document.fonts.forEach((f) => { if (f.status === 'loaded') fonts.add(f.family.replace(/["']/g, '') + ' ' + f.weight); }); } catch (e) {}

  const navLabels = [];
  if (navEl) for (const a of navEl.querySelectorAll('a')) {
    const t = (a.textContent || '').trim();
    if (t && t.length <= 30 && !navLabels.includes(t)) navLabels.push(t);
    if (navLabels.length >= 10) break;
  }

  const headings = h2s.length > 1 ? pick(h2s[1]) : (h2s.length > 0 ? pick(h2s[0]) : null);
  const meta = document.querySelector('meta[name="description"]');
  return {
    pageBackground: pageBg,
    elements: {
      body: pick(document.body), h1: pick(h1), h2: headings, h3: pick(h3),
      p: pProbe, a: pick(aEl), nav: pick(navEl), footer: pick(footEl),
    },
    bgPalette, textPalette, buttons, logo, sectionBackgrounds: secBgs,
    fontsLoaded: [...fonts].slice(0, 30),
    siteTitle: document.title || null,
    metaDescription: meta ? meta.getAttribute('content') : null,
    navLabels,
  };
})()`

/** Raw shape returned by the in-page probe (before button classification). */
type RawRenderedDesign = Omit<
  RenderedDesign,
  'url' | 'extractedAt' | 'headingFont' | 'headingFontStack' | 'bodyFont' | 'bodyFontStack' | 'primaryButton' | 'ghostButton' | 'headerButton'
>

/** 'rgb(206, 203, 246)' → relative luminance 0..1 (rough, for contrast picks). */
function luminanceOf(color: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (!m) return 0.5
  return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255
}

/** First family of a computed font stack, quotes stripped. */
function firstFamily(stack: string | null | undefined): string | null {
  if (!stack) return null
  const first = stack.split(',')[0]?.trim().replace(/["']/g, '')
  return first || null
}

/** Classify measured buttons into primary (filled), ghost (outlined), header. */
function classifyButtons(raw: RawRenderedDesign): {
  primaryButton: ButtonProbe | null
  ghostButton: ButtonProbe | null
  headerButton: ButtonProbe | null
} {
  const pageLum = luminanceOf(raw.pageBackground)
  const filled = raw.buttons.filter(
    (b) => b.background !== 'transparent' && Math.abs(luminanceOf(b.background) - pageLum) > 0.15,
  )
  // Most frequent filled background wins — that is the site's primary CTA color.
  const byBg = new Map<string, ButtonProbe[]>()
  for (const b of filled) {
    const list = byBg.get(b.background) ?? []
    list.push(b)
    byBg.set(b.background, list)
  }
  let primary: ButtonProbe | null = null
  let bestCount = 0
  for (const list of byBg.values()) {
    if (list.length > bestCount) {
      primary = list[0] ?? null
      bestCount = list.length
    }
  }
  const ghost =
    raw.buttons.find((b) => b.background === 'transparent' && /solid/.test(b.border)) ?? null
  const header = raw.buttons.find((b) => b.inHeader) ?? null
  return { primaryButton: primary, ghostButton: ghost, headerButton: header }
}

/**
 * Extract the full rendered design (computed styles, palette, buttons, logo,
 * section bands) from the live site. Returns null on any failure — callers
 * fall back to vision tokens / the FM shell, never crash.
 */
export async function extractRenderedDesign(url: string): Promise<RenderedDesign | null> {
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: VIEWPORTS.desktop })
    await settleNavigate(page, url)
    await scrollThrough(page)
    const raw = (await page.evaluate(RENDER_PROBE_JS)) as RawRenderedDesign
    return finishRenderedDesign(url, raw)
  } catch (err) {
    console.warn(
      `[designExtractor] rendered-design extraction failed for ${url}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

/** Enrich the raw probe with derived fields (fonts, button classification). */
function finishRenderedDesign(url: string, raw: RawRenderedDesign): RenderedDesign {
  const headingProbe = raw.elements.h1 ?? raw.elements.h2 ?? raw.elements.h3
  const bodyProbe = raw.elements.p ?? raw.elements.body
  return {
    ...raw,
    url,
    extractedAt: new Date().toISOString(),
    headingFont: firstFamily(headingProbe?.fontFamily),
    headingFontStack: headingProbe?.fontFamily ?? null,
    bodyFont: firstFamily(bodyProbe?.fontFamily),
    bodyFontStack: bodyProbe?.fontFamily ?? null,
    ...classifyButtons(raw),
  }
}

/**
 * One Playwright pass for designCloner: screenshots (for the vision model)
 * AND the rendered computed-style design. Each part degrades independently.
 */
export async function extractLiveDesign(
  url: string,
): Promise<{ shots: ScreenshotSet | null; rendered: RenderedDesign | null }> {
  let shots: ScreenshotSet | null = null
  let rendered: RenderedDesign | null = null
  try {
    shots = await extractDesignSystem(url)
  } catch (err) {
    console.warn(
      `[designExtractor] screenshot extraction failed for ${url}:`,
      err instanceof Error ? err.message : err,
    )
  }
  rendered = await extractRenderedDesign(url)
  return { shots, rendered }
}

// ─── Site structure extraction (plain HTML, no Playwright) ──────────────────
//
// fetchSiteStructure() reads the client's homepage with a plain fetch and
// parses the structural skeleton (nav labels, header CTA, footer columns,
// section order) with regexes — same dependency-free style as
// competitorWatcher.extractSnapshot. pageShell uses it to clone the client's
// UI/UX around our content; the meta description doubles as grounding text.

const STRUCTURE_TIMEOUT_MS = 10_000

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Resolve a href against the page URL; null for mailto/tel/javascript/anchors. */
function resolveHref(href: string, base: string): string | null {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href.trim())) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

/** All links inside an HTML fragment, labels stripped, hrefs resolved. */
function extractLinks(fragment: string, base: string, cap: number): SiteLink[] {
  const links: SiteLink[] = []
  for (const m of fragment.matchAll(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripTags(m[2] ?? '')
    const href = resolveHref(m[1] ?? '', base)
    if (!href || !label || label.length > 60) continue
    links.push({ label, href })
    if (links.length >= cap) break
  }
  return links
}

/** First matching block element's inner HTML, '' when absent. */
function blockHtml(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  return re.exec(html)?.[1] ?? ''
}

/**
 * Pure parser: homepage HTML → SiteStructure. Exported for tests.
 * Never throws — malformed HTML simply yields emptier fields.
 */
export function parseSiteStructure(url: string, html: string): SiteStructure {
  const clean = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const headerHtml = blockHtml(clean, 'header')
  const navHtml = blockHtml(clean, 'nav') || headerHtml
  const chromeHtml = `${navHtml}\n${headerHtml}`

  const navLinks = extractLinks(navHtml, url, 8)

  // CTA: a nav/header link styled as a button, or pointing at a contact page.
  let ctaText: string | null = null
  for (const m of chromeHtml.matchAll(/<a\s([^>]*?)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1] ?? ''
    const label = stripTags(m[2] ?? '')
    if (!label || label.length > 40) continue
    if (/class=["'][^"']*(?:btn|button|cta)/i.test(attrs) || /href=["'][^"']*(?:kontakt|contact|offerte|anfrage)/i.test(attrs)) {
      ctaText = label
      break
    }
  }

  const logoText =
    /<img\b[^>]*alt=["']([^"']{1,60})["']/i.exec(navHtml)?.[1]?.trim() ??
    (navLinks[0]?.label ?? null)

  // Footer columns: walk headings and links in document order, each heading
  // opens a new column and the following links belong to it.
  const footerHtml = blockHtml(clean, 'footer')
  const footerColumns: { heading: string; links: SiteLink[] }[] = []
  if (footerHtml) {
    let current: { heading: string; links: SiteLink[] } | null = null
    for (const m of footerHtml.matchAll(/<(h[1-6]|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const tag = (m[1] ?? '').toLowerCase()
      const text = stripTags(m[3] ?? '')
      if (tag.startsWith('h')) {
        if (text && text.length <= 40) {
          current = { heading: text, links: [] }
          footerColumns.push(current)
        }
      } else {
        const href = resolveHref(/href=["']([^"']*)["']/i.exec(m[2] ?? '')?.[1] ?? '', url)
        if (!href || !text || text.length > 60) continue
        if (!current) {
          current = { heading: '', links: [] }
          footerColumns.push(current)
        }
        current.links.push({ label: text, href: href })
      }
    }
  }

  const sectionOrder = [...clean.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => stripTags(m[1] ?? ''))
    .filter((t) => t.length > 0 && t.length <= 80)
    .slice(0, 10)

  const homeDescription =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.trim() ??
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1]?.trim() ??
    null

  return { navLinks, ctaText, logoText, footerColumns: footerColumns.slice(0, 6), sectionOrder, homeDescription }
}

/**
 * Fetch the client's homepage and parse its structure. Plain fetch with a
 * 10s timeout — no Playwright. Returns null on any failure; callers fall
 * back to the standard pageShell chrome (never a stub).
 */
export async function fetchSiteStructure(url: string): Promise<SiteStructure | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), STRUCTURE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; LeadEngine/1.0; +design-structure)',
        accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return null
    return parseSiteStructure(res.url || url, await res.text())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
