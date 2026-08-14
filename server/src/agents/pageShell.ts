/**
 * Page shell — renders the final HTML around structured content.
 *
 * The LLM never writes CSS. It returns a zod-validated PageContent object
 * and this shell renders a production-grade page around it, styled by
 * vision-extracted DesignTokens (client's live site) and structured by the
 * client's SiteStructure (nav labels, CTA text, footer columns, section
 * rhythm). When neither is available the Future Media house style renders
 * unchanged — never a stub.
 *
 * FORMAT LOCK: one page = one content type. The body renders ONLY the
 * payload matching content.pageType (faq → Q&A blocks, comparison → table +
 * verdict, listicle → numbered items, guide → step sections, table → data
 * table + note). Mixing formats in one page is not possible here.
 */
import { PACK_FOLDER } from '../config.js'
import type { Company } from '../types.js'
import type { DesignTokens } from './visionAnalyzer.js'
import type { PageType } from './pageTypeDecider.js'
import type { RenderedDesign, StyleProbe } from './designExtractor.js'
import type { SiteStructure } from './siteStructure.js'

export const FM = {
  bg: '#1B1B1E',
  nav: '#212121',
  panel: '#232327',
  panelAlt: '#2b5672',
  blue: '#116dff',
  blueSoft: '#5E97FF',
  lavender: '#CECBF6',
  text: '#FFFFFF',
  muted: '#A6A6AC',
  border: '#333338',
} as const

export interface FaqItem {
  q: string
  a: string
}
export interface GuideSection {
  h2: string
  paragraphs: string[]
  bullets?: string[]
}
export interface ListItem {
  title: string
  text: string
}
export interface ComparisonBlock {
  columns: string[]
  rows: { option: string; cells: string[] }[]
  verdict: string
}
export interface TableBlock {
  columns: string[]
  rows: { label: string; cells: string[] }[]
  note?: string
}
/** One "Fakten auf einen Blick" row — concrete number/timeframe/price range. */
export interface KeyFact {
  label: string
  value: string
}

/**
 * Page content contract. The MAIN body renders only the payload matching
 * `pageType`; on top of that every page carries the AEO baseline blocks —
 * `faq` (rendered as a static Q&A section on non-FAQ pages too) and
 * `keyFacts` (compact facts table with concrete numbers). The content
 * writer normalizes all fields.
 */
export interface PageContent {
  pageType: PageType
  heroTitle: string
  /** Answer capsule — 40-80 word direct answer, rendered as <p> under the H1. */
  heroLead: string
  /** Choice-billboard title, ≤60 chars, front-loading query + city. Null → derived. */
  seoTitle: string | null
  stats: { value: string; label: string }[]
  faq: FaqItem[]
  sections: GuideSection[]
  items: ListItem[]
  comparison: ComparisonBlock | null
  table: TableBlock | null
  /** "Fakten auf einen Blick" — always rendered when non-empty. */
  keyFacts: KeyFact[]
  ctaTitle: string
  ctaText: string
  metaDescription: string
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Host label for display, e.g. 'https://www.acme.ch/' → 'acme.ch'. */
const hostOf = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

// ─── AI-crawl-pack URLs (folder on the MAIN domain) ─────────────────────────
// The generated site is uploaded via FTP into https://<main-domain>/<folder>/
// — deliberately a FOLDER, never a subdomain: a folder inherits the main
// domain's authority and crawl history, a subdomain starts from zero. All
// canonical/og/sitemap/JSON-LD URLs are anchored here.

/** Origin of the client's main website ('https://www.acme.ch/x' → 'https://www.acme.ch'). */
export function mainOrigin(company: Company): string {
  try {
    return new URL(company.website).origin
  } catch {
    return company.website.replace(/\/+$/, '')
  }
}

/** Root of the deployed pack folder WITHOUT trailing slash, e.g. 'https://www.acme.ch/ki'. */
export function packBaseUrl(company: Company): string {
  return `${mainOrigin(company)}/${PACK_FOLDER}`
}

/**
 * Absolute deployed URL of one pack file. The index is the folder root
 * ('…/ki/'), every other file keeps its flat filename ('…/ki/foo.html').
 */
export function packUrl(company: Company, filename: string): string {
  const base = packBaseUrl(company)
  return filename === 'index.html' ? `${base}/` : `${base}/${filename}`
}

/**
 * Section heading. The stylesheet appends an accent-colored period (the
 * heading signature many brand sites use); trailing periods are stripped to
 * avoid doubling, and headings ending in ?/!/: suppress the decoration.
 */
const h2Html = (s: string): string => {
  const t = s.trim().replace(/\.+$/, '')
  const cls = /[?!:]$/.test(t) ? ' class="nodot"' : ''
  return `<h2${cls}>${esc(t)}</h2>`
}

/**
 * Everything in the stylesheet that a design-token set is allowed to tune.
 * Structural neutrals (nav, panel, border, muted) are part of the palette too
 * but always default to the FM values — vision tokens only override the
 * brand-level slots (primary/secondary/accent, background, text, type, rhythm),
 * so a partial or odd token set can never break contrast.
 */
interface ShellPalette {
  bg: string
  nav: string
  panel: string
  panelAlt: string
  blue: string
  blueSoft: string
  lavender: string
  text: string
  muted: string
  border: string
  /** Full CSS font-family stacks (quoted, with fallbacks). */
  headingFontCss: string
  bodyFontCss: string
  bodySize: string
  lineHeight: string
  h1: string
  h2: string
  h3: string
  sectionPadding: string
  wrapWidth: string
  gridGap: string
  // ── Measured-design extensions (rendered-DOM facts) ──
  headingWeight: string
  headingTransform: string
  headingSpacing: string
  linkColor: string
  btnBg: string
  btnText: string
  btnBorder: string
  btnRadius: string
  btnWeight: string
  btnSize: string
  btnTransform: string
  btnHeight: string
  ghostText: string
  ghostBorder: string
  /** Hero glow color (translucent accent). */
  glow: string
  cardRadius: string
  /** Hero text alignment — measured sites that left-align headings get 'left'. */
  heroAlign: 'center' | 'left'
  /** Header CTA button override (site's own header button style), null = primary. */
  navBtn: { bg: string; text: string; border: string } | null
  /** Google Fonts stylesheet href for the measured families, when derivable. */
  googleFontsHref: string | null
}

/** The Future Media house style — identical to what the hardcoded CSS used. */
const FM_PALETTE: ShellPalette = {
  bg: FM.bg,
  nav: FM.nav,
  panel: FM.panel,
  panelAlt: FM.panelAlt,
  blue: FM.blue,
  blueSoft: FM.blueSoft,
  lavender: FM.lavender,
  text: FM.text,
  muted: FM.muted,
  border: FM.border,
  headingFontCss: "'Helvetica Neue',Arial,sans-serif",
  bodyFontCss: "'Helvetica Neue',Arial,sans-serif",
  bodySize: '16px',
  lineHeight: '1.65',
  h1: '48px',
  h2: '26px',
  h3: '17px',
  sectionPadding: '64px',
  wrapWidth: '1080px',
  gridGap: '18px',
  headingWeight: '800',
  headingTransform: 'none',
  headingSpacing: '-.5px',
  linkColor: FM.blueSoft,
  btnBg: FM.blue,
  btnText: '#fff',
  btnBorder: 'none',
  btnRadius: '8px',
  btnWeight: '600',
  btnSize: '15px',
  btnTransform: 'none',
  btnHeight: '45px',
  ghostText: FM.text,
  ghostBorder: `1px solid ${FM.border}`,
  glow: 'rgba(17,109,255,.14)',
  cardRadius: '14px',
  heroAlign: 'center',
  navBtn: null,
  googleFontsHref: null,
}

/** Strip characters that could break out of a CSS value context (tokens are LLM output). */
const cssSafe = (s: string): string => s.replace(/["'{};<>\\]/g, '').trim()

/** Pick a sanitized token value, falling back to the FM default when empty. */
const tokenValue = (value: string, fallback: string): string => cssSafe(value) || fallback

/** Wrap a bare font name into a stack with fallbacks. */
const fontStack = (name: string, fallback = 'Arial,sans-serif'): string =>
  `'${cssSafe(name)}',${fallback}`

/**
 * Map vision-extracted DesignTokens onto the shell palette. Only the
 * brand-level slots are overridden; nav/panel/border/muted stay FM so the
 * page keeps its structural contrast regardless of what the vision API saw.
 */
export function cssFromTokens(t: DesignTokens): string {
  return cssFromPalette(paletteFromTokens(t))
}

function paletteFromTokens(t: DesignTokens): ShellPalette {
  const blue = tokenValue(t.colors.primary, FM_PALETTE.blue)
  return {
    ...FM_PALETTE,
    bg: tokenValue(t.colors.background, FM_PALETTE.bg),
    text: tokenValue(t.colors.text, FM_PALETTE.text),
    blue,
    blueSoft: tokenValue(t.colors.accent, FM_PALETTE.blueSoft),
    panelAlt: tokenValue(t.colors.secondary, FM_PALETTE.panelAlt),
    linkColor: tokenValue(t.colors.accent, FM_PALETTE.blueSoft),
    btnBg: blue,
    headingFontCss: fontStack(tokenValue(t.typography.headingFont, 'Helvetica Neue')),
    bodyFontCss: fontStack(tokenValue(t.typography.bodyFont, 'Helvetica Neue')),
    bodySize: tokenValue(t.typography.bodySize, FM_PALETTE.bodySize),
    lineHeight: tokenValue(t.typography.lineHeight, FM_PALETTE.lineHeight),
    h1: tokenValue(t.typography.headingSizes.h1, FM_PALETTE.h1),
    h2: tokenValue(t.typography.headingSizes.h2, FM_PALETTE.h2),
    h3: tokenValue(t.typography.headingSizes.h3, FM_PALETTE.h3),
    sectionPadding: tokenValue(t.spacing.sectionPadding, FM_PALETTE.sectionPadding),
    wrapWidth: tokenValue(t.spacing.containerMaxWidth, FM_PALETTE.wrapWidth),
    gridGap: tokenValue(t.spacing.gridGap, FM_PALETTE.gridGap),
  }
}

// ─── Measured-design palette (rendered-DOM computed styles) ─────────────────
// These facts come straight from getComputedStyle on the client's live site
// and always OVERRIDE vision-token guesses. Vision tokens only fill gaps.

/** 'rgb(27, 27, 30)' → luminance 0..1; non-parseable → 0.5. */
function lum(color: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (m) return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255
  const h = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (h && h[1]) {
    const v = parseInt(h[1], 16)
    return (0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255
  }
  return 0.5
}

/** Saturation 0..1 of an rgb()/hex color (max-min channel spread). */
function sat(color: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (!m) return 0
  const ch = [Number(m[1]), Number(m[2]), Number(m[3])]
  const mx = Math.max(...ch)
  const mn = Math.min(...ch)
  return mx === 0 ? 0 : (mx - mn) / mx
}

/** True for rgba(...) colors that are not fully opaque. */
const isTranslucent = (c: string): boolean => /rgba\([^)]+,\s*(0|0?\.\d+)\)\s*$/.test(c)

/** rgb()/hex → rgba() with the given alpha (falls back to the input). */
function withAlpha(color: string, alpha: number): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`
  const h = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (h && h[1]) {
    const v = parseInt(h[1], 16)
    return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${alpha})`
  }
  return color
}

/** Mix `color` toward white/black by `amount` (0..1) — panel/border derivation. */
function mixTowards(color: string, towardWhite: boolean, amount: number): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  let ch: number[] | null = null
  if (m) ch = [Number(m[1]), Number(m[2]), Number(m[3])]
  else {
    const h = /^#([0-9a-f]{6})$/i.exec(color.trim())
    if (h && h[1]) {
      const v = parseInt(h[1], 16)
      ch = [v >> 16, (v >> 8) & 255, v & 255]
    }
  }
  if (!ch) return color
  const target = towardWhite ? 255 : 0
  const out = ch.map((c) => Math.round(c + (target - c) * amount))
  return `rgb(${out[0]},${out[1]},${out[2]})`
}

/** UA default link blue — means the site never styled bare links. */
const UA_LINK_BLUE = /^rgb\(0,\s*0,\s*238\)$/

/** Generic families that carry no brand identity. */
const GENERIC_FONTS = new Set(['arial', 'helvetica', 'helvetica neue', 'sans-serif', 'serif', 'system-ui', 'times new roman', 'georgia', '-apple-system'])

/** 'poppins-v2' → 'Poppins'; 'raleway' → 'Raleway'. */
function cleanFamily(raw: string): string {
  return raw
    .replace(/["']/g, '')
    .replace(/-v\d+$/i, '')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Google Fonts href for the measured families (best-effort web equivalent). */
function googleFontsHref(families: string[]): string | null {
  const wanted = [...new Set(families.map(cleanFamily))].filter(
    (f) => f && !GENERIC_FONTS.has(f.toLowerCase()),
  )
  if (wanted.length === 0) return null
  const parts = wanted.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;800`)
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`
}

/** CSS stack: cleaned web family first, raw measured family second, fallbacks last. */
function measuredFontCss(rawStack: string | null, fallback: string): string {
  if (!rawStack) return fallback
  const first = rawStack.split(',')[0]?.replace(/["']/g, '').trim()
  if (!first) return fallback
  const clean = cleanFamily(first)
  const rest = rawStack
    .split(',')
    .slice(1)
    .map((s) => s.replace(/["']/g, '').trim())
    .filter(Boolean)
    .slice(0, 2)
  const stack = [clean, first, ...rest]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((f) => (/\s|-/.test(f) ? `'${cssSafe(f)}'` : cssSafe(f)))
  return `${stack.join(',')},sans-serif`
}

/** Clamp a measured px size into a sensible landing-page range. */
function clampPx(measured: string | undefined, min: number, max: number, fallback: number): string {
  const n = measured ? parseFloat(measured) : NaN
  if (!Number.isFinite(n)) return `${fallback}px`
  return `${Math.round(Math.min(max, Math.max(min, n)))}px`
}

/**
 * Build the shell palette from the MEASURED rendered design. Every fact that
 * was measured is used verbatim (colors stay in rgb() notation — valid CSS);
 * vision tokens and FM defaults only fill the gaps.
 */
export function paletteFromRendered(r: RenderedDesign, t: DesignTokens | null): ShellPalette {
  const base = t ? paletteFromTokens(t) : { ...FM_PALETTE }
  const bg = cssSafe(r.pageBackground) || base.bg
  const dark = lum(bg) < 0.5

  // Text: dominant measured text color.
  const text = cssSafe(r.textPalette[0]?.color ?? r.elements.p?.color ?? '') || base.text

  // Opaque background colors near the page background, subtlest first.
  // Panel (cards) must be a SUBTLE step from the page background — a color
  // that is too far off (e.g. a footer band color) becomes panelAlt instead.
  const nearBg = r.bgPalette
    .map((p) => p.color)
    .filter((c) => !isTranslucent(c) && c !== bg && Math.abs(lum(c) - lum(bg)) < 0.18)
    .sort((a, b) => Math.abs(lum(a) - lum(bg)) - Math.abs(lum(b) - lum(bg)))
  const subtle = nearBg.filter((c) => Math.abs(lum(c) - lum(bg)) < 0.12)
  const panel = cssSafe(subtle[0] ?? '') || mixTowards(bg, !dark, 0.055)
  const panelAlt = cssSafe(nearBg.find((c) => c !== subtle[0]) ?? '') || mixTowards(bg, !dark, 0.14)

  // Accent: the primary button's background is the strongest signal; else the
  // most saturated palette color that is neither bg nor text.
  const paletteColors = [...r.bgPalette, ...r.textPalette].map((p) => p.color).filter((c) => !isTranslucent(c))
  const saturated = paletteColors
    .filter((c) => c !== bg && c !== text && sat(c) > 0.12 && Math.abs(lum(c) - lum(bg)) > 0.1)
    .sort((a, b) => sat(b) - sat(a))
  const accent = cssSafe(r.primaryButton?.background ?? saturated[0] ?? '') || base.blue

  // Soft accent (stat numbers, hero em, links): a light-but-tinted text color.
  const softCandidate = r.textPalette
    .slice(0, 5)
    .map((p) => p.color)
    .find((c) => c !== text && sat(c) > 0.05 && Math.abs(lum(c) - lum(text)) < 0.35)
  const accentSoft = cssSafe(softCandidate ?? '') || accent

  // Muted: mid-luminance measured text color, else a mix of text into bg.
  const mutedCandidate = r.textPalette
    .slice(0, 8)
    .map((p) => p.color)
    .find((c) => {
      const dl = Math.abs(lum(c) - lum(bg))
      return c !== text && sat(c) < 0.12 && dl > 0.25 && dl < 0.75
    })
  const muted = cssSafe(mutedCandidate ?? '') || mixTowards(text, !dark, 0.35)

  // Border: nudge the panel color toward the text side for a subtle 1px line.
  const border = mixTowards(panel, dark, 0.14)

  // Links: measured, unless the site left them at the UA default.
  const aColor = r.elements.a?.color ?? ''
  const linkColor = aColor && !UA_LINK_BLUE.test(aColor) ? cssSafe(aColor) : text

  // Buttons: exact measured styles. Primary = filled CTA, ghost = outlined.
  const pb = r.primaryButton
  const gb = r.ghostButton ?? r.headerButton
  const btnRadius = cssSafe(pb?.borderRadius ?? gb?.borderRadius ?? '') || base.btnRadius
  const heading = r.elements.h1 ?? r.elements.h2

  const headingFamilies = [r.headingFont, r.bodyFont].filter((f): f is string => Boolean(f))

  return {
    ...base,
    bg,
    nav: bg,
    panel,
    panelAlt,
    blue: accent,
    blueSoft: accentSoft,
    lavender: accentSoft,
    text,
    muted,
    border,
    headingFontCss: measuredFontCss(r.headingFontStack, base.headingFontCss),
    bodyFontCss: measuredFontCss(r.bodyFontStack, base.bodyFontCss),
    bodySize: clampPx(r.elements.p?.fontSize, 14, 19, 16),
    lineHeight: base.lineHeight,
    h1: clampPx(heading?.fontSize, 34, 64, 48),
    h2: clampPx(r.elements.h2?.fontSize, 24, 42, 30),
    h3: clampPx(r.elements.h3?.fontSize, 15, 22, 17),
    headingWeight: cssSafe(heading?.fontWeight ?? '') || base.headingWeight,
    headingTransform: cssSafe(heading?.textTransform ?? '') || 'none',
    headingSpacing: heading?.letterSpacing === 'normal' ? 'normal' : cssSafe(heading?.letterSpacing ?? '') || 'normal',
    linkColor,
    btnBg: cssSafe(pb?.background ?? '') || accent,
    btnText: cssSafe(pb?.textColor ?? '') || (lum(accent) > 0.55 ? '#111' : '#fff'),
    btnBorder: pb && /solid/.test(pb.border) ? cssSafe(pb.border) : 'none',
    btnRadius,
    btnWeight: cssSafe(pb?.fontWeight ?? gb?.fontWeight ?? '') || base.btnWeight,
    btnSize: clampPx(pb?.fontSize ?? gb?.fontSize, 12, 17, 14),
    btnTransform: cssSafe(pb?.textTransform ?? '') || 'none',
    btnHeight: `${Math.min(56, Math.max(34, pb?.height ?? gb?.height ?? 44))}px`,
    ghostText: cssSafe(gb?.textColor ?? '') || text,
    ghostBorder: gb && /solid/.test(gb.border) ? cssSafe(gb.border) : `1px solid ${withAlpha(text, 0.6)}`,
    glow: withAlpha(sat(accent) > 0.05 ? accent : accentSoft, 0.14),
    cardRadius: `${Math.min(26, Math.max(8, parseFloat(btnRadius) || 14))}px`,
    // Sites whose measured headings are left-aligned get a left-aligned hero.
    heroAlign: ['start', 'left'].includes(heading?.textAlign ?? '') ? 'left' : 'center',
    // Header CTA in the site's OWN header-button style (often the ghost pill).
    navBtn: r.headerButton
      ? {
          bg: r.headerButton.background === 'transparent' ? 'transparent' : cssSafe(r.headerButton.background),
          text: cssSafe(r.headerButton.textColor) || text,
          border: /solid/.test(r.headerButton.border) ? cssSafe(r.headerButton.border) : 'none',
        }
      : null,
    googleFontsHref: googleFontsHref(headingFamilies),
  }
}

/** CSS for a measured rendered design (vision tokens fill gaps only). */
export function cssFromRendered(r: RenderedDesign, t: DesignTokens | null): string {
  return cssFromPalette(paletteFromRendered(r, t))
}

/** Heading probe accessor kept exported for tests. */
export type { StyleProbe }

function cssFromPalette(p: ShellPalette): string {
  return `
:root{--bg:${p.bg};--nav:${p.nav};--panel:${p.panel};--panel-alt:${p.panelAlt};--blue:${p.blue};--blue-soft:${p.blueSoft};--lavender:${p.lavender};--text:${p.text};--muted:${p.muted};--border:${p.border};--link:${p.linkColor}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:${p.bodyFontCss};font-size:${p.bodySize};line-height:${p.lineHeight};-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:${p.headingFontCss};text-transform:${p.headingTransform}}
a{color:var(--link);text-decoration:none}
a:hover{text-decoration:underline}
section a,footer .col a{text-decoration:underline;text-underline-offset:3px}
.wrap{max-width:${p.wrapWidth};margin:0 auto;padding:0 24px}
nav{position:sticky;top:0;z-index:50;background:${withAlpha(p.nav, 0.9)};backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:28px;height:72px}
nav .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px;color:var(--text);letter-spacing:.2px;text-decoration:none}
nav .brand:hover{text-decoration:none}
nav .brand img{display:block;max-height:40px;width:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;background:${p.btnBg};color:${p.btnText};height:${p.btnHeight};padding:0 28px;border-radius:${p.btnRadius};font-weight:${p.btnWeight};font-size:${p.btnSize};font-family:${p.bodyFontCss};text-transform:${p.btnTransform};border:${p.btnBorder};cursor:pointer}
.btn:hover{filter:brightness(1.08);text-decoration:none}
.btn.ghost{background:transparent;border:${p.ghostBorder};color:${p.ghostText}}
nav .btn{height:40px;padding:0 22px${p.navBtn ? `;background:${p.navBtn.bg};color:${p.navBtn.text};border:${p.navBtn.border}` : ''}}
.hero{padding:96px 0 72px;text-align:${p.heroAlign};background:radial-gradient(ellipse 60% 50% at 50% 0%,${p.glow},transparent)}
.hero h1{font-size:clamp(30px,4.6vw,${p.h1});font-weight:${p.headingWeight};line-height:1.12;letter-spacing:${p.headingSpacing};max-width:860px;margin:0 ${p.heroAlign === 'center' ? 'auto' : '0'} 22px}
.hero h1 em{font-style:normal;color:var(--lavender)}
.hero .lead{font-size:18px;color:var(--lavender);max-width:680px;margin:0 ${p.heroAlign === 'center' ? 'auto' : '0'} 34px}
.hero .actions{display:flex;gap:14px;justify-content:${p.heroAlign === 'center' ? 'center' : 'flex-start'}}
.stats{display:flex;justify-content:center;gap:0;margin-top:56px;border:1px solid var(--border);border-radius:${p.cardRadius};overflow:hidden;max-width:760px;margin-left:${p.heroAlign === 'center' ? 'auto' : '0'};margin-right:auto}
.stats div{flex:1;padding:22px 12px;text-align:center;background:var(--panel)}
.stats div+div{border-left:1px solid var(--border)}
.stats b{display:block;font-size:26px;font-family:${p.headingFontCss};font-weight:${p.headingWeight};color:var(--text)}
.stats span{font-size:12.5px;color:var(--muted)}
section{padding:${p.sectionPadding} 0}
section.alt{background:var(--panel)}
h2{font-size:${p.h2};font-weight:${p.headingWeight};letter-spacing:${p.headingSpacing};margin-bottom:14px}
h2::after{content:'.';color:var(--lavender)}
h2.nodot::after{content:none}
section p{color:var(--muted);max-width:720px;margin-bottom:12px}
ul.tick{list-style:none;margin-top:16px;max-width:720px}
ul.tick li{padding:10px 0 10px 30px;position:relative;color:var(--muted);border-bottom:1px solid var(--border);font-size:15px}
ul.tick li::before{content:'→';position:absolute;left:2px;color:var(--lavender);font-weight:700}
.faq .qa{background:var(--panel);border:1px solid var(--border);border-radius:${p.cardRadius};margin-bottom:12px;padding:18px 22px}
.faq .qa h3{font-size:15.5px;font-weight:600;margin-bottom:8px;color:var(--text)}
.faq .qa p{font-size:14.5px;margin:0;max-width:none}
.updated{font-size:13px;color:var(--muted);margin-bottom:28px}
table.cmp{width:100%;border-collapse:collapse;margin-top:28px;background:var(--panel);border:1px solid var(--border);border-radius:${p.cardRadius};overflow:hidden}
table.cmp th{background:var(--panel-alt);color:var(--text);text-align:left;padding:14px 16px;font-size:14px;font-weight:600}
table.cmp td{padding:13px 16px;border-top:1px solid var(--border);font-size:14.5px;color:var(--muted);vertical-align:top}
table.cmp td:first-child{color:var(--text);font-weight:600}
.verdict{margin-top:26px;background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--lavender);border-radius:${p.cardRadius};padding:20px 22px;max-width:760px;color:var(--muted);font-size:15px}
ol.items{list-style:none;counter-reset:item;margin-top:28px;max-width:760px}
ol.items li{counter-increment:item;padding:18px 0 18px 56px;position:relative;border-bottom:1px solid var(--border)}
ol.items li::before{content:counter(item);position:absolute;left:0;top:16px;width:34px;height:34px;border-radius:50%;background:${p.btnBg};color:${p.btnText};font-weight:700;display:flex;align-items:center;justify-content:center;font-size:15px}
ol.items h3{font-size:${p.h3};margin-bottom:6px;color:var(--text)}
ol.items p{margin:0;font-size:15px}
.cta{background:var(--panel);border:1px solid var(--border);border-radius:${p.cardRadius};padding:52px 40px;text-align:center;position:relative;overflow:hidden}
.cta::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 70% 90% at 50% 110%,${p.glow},transparent);pointer-events:none}
.cta>*{position:relative}
.cta p{margin-left:auto;margin-right:auto}
.cta .actions{display:flex;gap:14px;justify-content:center;margin-top:26px}
footer{border-top:1px solid var(--border);color:var(--muted);font-size:13.5px;background:var(--bg)}
footer .cols{display:flex;justify-content:space-between;flex-wrap:wrap;gap:28px;padding:36px 0 28px}
footer .col h4{color:var(--text);font-size:13px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;font-family:${p.headingFontCss}}
footer .col a{display:block;color:var(--muted);padding:3px 0;font-size:13.5px}
footer .col a:hover{color:var(--text)}
footer .brandline{color:var(--text);font-weight:600;margin-bottom:6px}
footer .band{background:var(--panel-alt);padding:16px 0 14px}
footer .base{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
footer .band,footer .band a{color:${lum(p.panelAlt) > 0.55 ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.85)'}}
footer a{color:var(--muted)}
footer a:hover{color:var(--text)}
footer .band a:hover{color:inherit}
footer .attr{width:100%;margin-top:8px;font-size:12.5px;opacity:.8}
@media(max-width:640px){.hero{padding:64px 0 48px}table.cmp{display:block;overflow-x:auto}nav .wrap{gap:12px}}
`
}

const CSS = cssFromPalette(FM_PALETTE)

/**
 * Resolve the effective shell palette: measured rendered design first,
 * vision tokens second, FM house style last.
 */
function resolvePalette(rendered?: RenderedDesign | null, tokens?: DesignTokens | null): ShellPalette {
  if (rendered) return paletteFromRendered(rendered, tokens ?? null)
  if (tokens) return paletteFromTokens(tokens)
  return FM_PALETTE
}

/** <head> font links for the measured families (empty when none derivable). */
function fontLinksHtml(p: ShellPalette): string {
  if (!p.googleFontsHref) return ''
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${p.googleFontsHref}">`
}

/**
 * Header chrome: the client's real logo (hotlinked, with a text fallback
 * that appears when the image fails) + ONE CTA button in the client's exact
 * button style, linking to the main site. Landing pages deliberately carry
 * NO invented multi-item navigation.
 */
function headerHtml(
  company: Company,
  site: string,
  ctaText: string,
  rendered?: RenderedDesign | null,
  logoTextFallback?: string | null,
): string {
  const brandText = (logoTextFallback && logoTextFallback !== 'Home' ? logoTextFallback : null) ?? company.name.replace(/ (GmbH|AG)$/, '')
  const logo = rendered?.logo
  const brandInner = logo
    ? `<img src="${esc(logo.src)}" alt="${esc(company.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span style="display:none">${esc(brandText)}</span>`
    : esc(brandText)
  return `<nav>
  <div class="wrap">
    <a class="brand" href="${esc(site)}">${brandInner}</a>
    <a class="btn" href="${esc(site)}">${esc(ctaText)}</a>
  </div>
</nav>`
}

/**
 * Minimal landing-page footer: company name, link to the main site, the
 * "Weitere Themen" interlinking column and an imprint-style base line.
 */
function footerHtml(
  company: Company,
  site: string,
  lang: 'de' | 'en',
  siblings: { filename: string; title: string }[],
): string {
  const siblingCol =
    siblings.length > 0
      ? `<div class="col">
      <h4>${lang === 'en' ? 'More topics' : 'Weitere Themen'}</h4>
      ${siblings
        .slice(0, 5)
        .map((s) => `<a href="${esc(s.filename)}">${esc(s.title.length > 40 ? s.title.slice(0, 38) + '…' : s.title)}</a>`)
        .join('\n      ')}
      <a href="index.html">${lang === 'en' ? 'All topics' : 'Alle Themen'}</a>
    </div>`
      : ''
  const year = new Date().getFullYear()
  return `<footer>
  <div class="wrap">
    <div class="cols">
      <div class="col">
        <div class="brandline">${esc(company.name)}</div>
        <a href="${esc(site)}">${esc(hostOf(site))}</a>
      </div>
      ${siblingCol}
    </div>
  </div>
  <div class="band">
    <div class="wrap">
      <div class="base">
        <div>© ${year} ${esc(company.name)} — ${esc(company.sector)}, ${esc(company.location)}</div>
        <div><a href="${esc(site)}">${esc(hostOf(site))}</a></div>
      </div>
      <div class="attr">Provided by ${esc(company.name)} — <a href="${esc(site)}">${esc(hostOf(site))}</a></div>
    </div>
  </div>
</footer>`
}

// ─── Format-locked body renderers ───────────────────────────────────────────
// Each renderer emits exactly ONE content type — a page never mixes two.

/**
 * FAQ section — static h3+p pairs, deliberately NOT <details>/accordions:
 * answer engines must see every answer in the initial HTML, nothing
 * collapsed or JS-gated.
 */
function faqBody(faq: FaqItem[], heading = 'Häufige Fragen'): string {
  const items = faq
    .map((f) => `<div class="qa">\n    <h3>${esc(f.q)}</h3>\n    <p>${esc(f.a)}</p>\n  </div>`)
    .join('\n  ')
  return `<section id="faq" class="alt">
  <div class="wrap">
    ${h2Html(heading)}
    <div class="faq" style="margin-top:24px">
  ${items}
    </div>
  </div>
</section>`
}

/** Key-facts block — compact facts table (numbers, timelines, price ranges). */
function keyFactsBody(facts: KeyFact[], heading = 'Fakten auf einen Blick'): string {
  const rows = facts
    .map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(f.value)}</td></tr>`)
    .join('\n      ')
  return `<section id="fakten">
  <div class="wrap">
    ${h2Html(heading)}
    <table class="cmp">
      <tbody>
      ${rows}
      </tbody>
    </table>
  </div>
</section>`
}

function comparisonBody(cmp: ComparisonBlock): string {
  const head = cmp.columns.map((c) => `<th>${esc(c)}</th>`).join('')
  const rows = cmp.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.option)}</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`,
    )
    .join('\n      ')
  return `<section>
  <div class="wrap">
    ${h2Html('Der Vergleich')}
    <table class="cmp">
      <thead><tr>${head}</tr></thead>
      <tbody>
      ${rows}
      </tbody>
    </table>
    <div class="verdict">${esc(cmp.verdict)}</div>
  </div>
</section>`
}

function tableBody(t: TableBlock): string {
  const head = t.columns.map((c) => `<th>${esc(c)}</th>`).join('')
  const rows = t.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.label)}</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`,
    )
    .join('\n      ')
  const note = t.note ? `<div class="verdict">${esc(t.note)}</div>` : ''
  return `<section>
  <div class="wrap">
    ${h2Html('Die Fakten im Überblick')}
    <table class="cmp">
      <thead><tr>${head}</tr></thead>
      <tbody>
      ${rows}
      </tbody>
    </table>
    ${note}
  </div>
</section>`
}

function listicleBody(items: ListItem[]): string {
  const lis = items
    .map((it) => `  <li><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></li>`)
    .join('\n')
  return `<section>
  <div class="wrap">
    <ol class="items">
${lis}
    </ol>
  </div>
</section>`
}

function guideBody(sections: GuideSection[]): string {
  return sections
    .map((sec, i) => {
      const bullets = sec.bullets?.length
        ? `<ul class="tick">\n${sec.bullets.map((b) => `  <li>${esc(b)}</li>`).join('\n')}\n</ul>`
        : ''
      const paras = sec.paragraphs.filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('\n    ')
      return `<section${i % 2 === 1 ? ' class="alt"' : ''}>
  <div class="wrap">
    ${h2Html(sec.h2)}
    ${paras}
    ${bullets}
  </div>
</section>`
    })
    .join('\n\n')
}

/**
 * The MAIN page body: the payload matching content.pageType. When that
 * payload is unexpectedly empty, degrade to whichever single payload exists.
 * The AEO baseline blocks (keyFacts, FAQ on non-FAQ pages) are appended by
 * renderPage, not here.
 */
function mainBodyHtml(c: PageContent, faqHeading: string): string {
  if (c.pageType === 'faq' && c.faq.length > 0) return faqBody(c.faq, faqHeading)
  if (c.pageType === 'comparison' && c.comparison) return comparisonBody(c.comparison)
  if (c.pageType === 'table' && c.table) return tableBody(c.table)
  if (c.pageType === 'listicle' && c.items.length > 0) return listicleBody(c.items)
  if (c.pageType === 'guide' && c.sections.length > 0) return guideBody(c.sections)
  // degraded — render the one non-empty payload, in structure order
  if (c.faq.length > 0) return faqBody(c.faq, faqHeading)
  if (c.comparison) return comparisonBody(c.comparison)
  if (c.table) return tableBody(c.table)
  if (c.items.length > 0) return listicleBody(c.items)
  if (c.sections.length > 0) return guideBody(c.sections)
  return ''
}

// ─── Choice billboard + freshness helpers ───────────────────────────────────

/**
 * Clip to a max length on a word boundary (billboard title budget). Always
 * cuts at the last FULL word inside the budget — never mid-word (a hard
 * mid-word slice is only the last resort for a single unbroken token).
 */
function clip(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : t.slice(0, max)).replace(/[\s,;:–—|-]+$/, '')
}

/** Primary city from "Zürich, Schweiz" style locations. */
function cityOf(location: string): string {
  return location.split(',')[0]?.trim() || location
}

/**
 * <title> ≤60 chars, front-loading the target query + city (writer's
 * seoTitle preferred, deterministic derivation otherwise).
 */
function billboardTitle(c: PageContent, targetQuery: string, city: string): string {
  if (c.seoTitle) return clip(c.seoTitle, 60)
  const base = `${targetQuery} ${city}`.replace(/\s+/g, ' ')
  return clip(base.length >= 20 ? base : `${c.heroTitle} ${city}`, 60)
}

/** Visible freshness line, e.g. "Zuletzt aktualisiert: 11.08.2026". */
function freshnessLine(lang: 'de' | 'en', isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return lang === 'en' ? `Last updated: ${isoDate}` : `Zuletzt aktualisiert: ${d}.${m}.${y}`
}

/** Serialize JSON-LD safely for embedding in a <script> tag. */
function jsonLdScript(data: unknown): string {
  try {
    const json = JSON.stringify(data).replace(/</g, '\\u003c')
    return `<script type="application/ld+json">${json}</script>`
  } catch {
    return '' // never let a serialization edge case break the page
  }
}

/** https URL from a bare domain hint ("linkedin.com/company/x" → https://…). */
function asUrl(hint: string): string | null {
  const h = hint.trim()
  if (!h || !/^[a-z0-9]/i.test(h)) return null
  return /^https?:\/\//i.test(h) ? h : `https://${h}`
}

/** Render a full landing page around LLM-written content. */
export function renderPage(
  company: Company,
  c: PageContent,
  opts: {
    filename: string
    siblings: { filename: string; title: string }[]
    schemaType: 'FAQPage' | 'Article'
    targetQuery: string
    /**
     * Canonical URL of THIS page on the client's domain (website + slug).
     * Falls back to the main website when absent.
     */
    canonicalUrl?: string
    /**
     * Vision-extracted design tokens (designCloner.cloneClientDesign).
     * Gap-filler only when `rendered` is present; without `rendered` the
     * stylesheet is derived from them via cssFromTokens; when both are
     * absent the FM house style (CSS) is used unchanged.
     */
    designTokens?: DesignTokens
    /**
     * MEASURED rendered-DOM design of the client's live site
     * (designExtractor.extractRenderedDesign). When present it is the
     * primary style source — exact colors, fonts, buttons, logo.
     */
    rendered?: RenderedDesign | null
    /**
     * Structure of the client's live site (CTA text, meta description).
     * Used for the header CTA label and grounding — NOT for cloning nav
     * menus (landing pages carry no invented navigation).
     */
    structure?: SiteStructure
  },
): string {
  const palette = resolvePalette(opts.rendered, opts.designTokens)
  const css = cssFromPalette(palette)
  const structure = opts.structure
  const today = new Date().toISOString().slice(0, 10)
  const site = company.website
  const lang = company.language
  const city = cityOf(company.location)
  const canonical = opts.canonicalUrl ?? site
  const pageTitle = billboardTitle(c, opts.targetQuery, city)
  const metaDesc = c.metaDescription.slice(0, 155)

  const navCtaText =
    structure?.ctaText ?? opts.rendered?.headerButton?.text ?? opts.rendered?.primaryButton?.text ?? 'Kontakt'

  const stats = c.stats
    .slice(0, 3)
    .map((s) => `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`)
    .join('\n      ')
  const statsHtml = c.stats.length > 0 ? `<div class="stats">\n      ${stats}\n    </div>` : ''

  // ── Body composition: format-locked main body + AEO baseline blocks ──
  const faqHeading = lang === 'en' ? 'Frequently Asked Questions' : 'Häufige Fragen'
  const factsHeading = lang === 'en' ? 'Key facts at a glance' : 'Fakten auf einen Blick'
  const mainBody = mainBodyHtml(c, faqHeading)
  const mainIsFaq = mainBody.includes('id="faq"')
  const extraBlocks = [
    c.keyFacts.length > 0 ? keyFactsBody(c.keyFacts, factsHeading) : '',
    !mainIsFaq && c.faq.length > 0 ? faqBody(c.faq, faqHeading) : '',
  ].filter(Boolean)
  const body = [mainBody, ...extraBlocks].filter(Boolean).join('\n\n')

  // Hero secondary action: on FAQ pages it anchors into the Q&A block, on
  // every other format it is one more link to the client's main site.
  const secondaryAction =
    c.pageType === 'faq' && c.faq.length > 0
      ? `<a class="btn ghost" href="#faq">${esc(faqHeading)}</a>`
      : `<a class="btn ghost" href="${esc(site)}">${esc(hostOf(site))}</a>`

  // ── JSON-LD graph: Organization(sameAs) + LocalBusiness + Service +
  //    WebPage(dateModified) + Article and/or FAQPage ──
  const siteBase = site.replace(/\/$/, '')
  const orgId = `${siteBase}#organization`
  const bizId = `${siteBase}#localbusiness`
  const ownHost = hostOf(site).replace(/^www\./, '')
  const sameAs = [
    ...new Set(
      company.domainHints
        .map(asUrl)
        .filter(
          (u): u is string =>
            u !== null &&
            !u.replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(ownHost),
        ),
    ),
  ]
  const organization = {
    '@type': 'Organization',
    '@id': orgId,
    name: company.name,
    url: site,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  }
  const localBusiness = {
    '@type': 'LocalBusiness',
    '@id': bizId,
    name: company.name,
    url: site,
    description: `${company.sector} in ${company.location}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '[Strasse und Hausnummer ergänzen]',
      addressLocality: city,
      addressCountry: 'CH',
    },
    areaServed: (company.locations.length > 0 ? company.locations : [city]).map((l) => ({
      '@type': 'City',
      name: cityOf(l),
    })),
    parentOrganization: { '@id': orgId },
  }
  const service = {
    '@type': 'Service',
    name: clip(opts.targetQuery, 100),
    serviceType: company.sector,
    provider: { '@id': bizId },
    areaServed: { '@type': 'City', name: city },
  }
  const webPage = {
    '@type': 'WebPage',
    '@id': canonical,
    url: canonical,
    name: pageTitle,
    description: metaDesc,
    inLanguage: lang === 'en' ? 'en' : 'de-CH',
    datePublished: today,
    dateModified: today,
    about: { '@id': orgId },
  }
  const graph: unknown[] = [organization, localBusiness, service, webPage]
  if (opts.schemaType !== 'FAQPage' || c.faq.length === 0) {
    graph.push({
      '@type': 'Article',
      headline: c.heroTitle,
      description: metaDesc,
      mainEntityOfPage: { '@id': canonical },
      about: { '@id': orgId },
      author: { '@id': orgId },
      publisher: { '@id': orgId },
      datePublished: today,
      dateModified: today,
    })
  }
  if (c.faq.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntityOfPage: { '@id': canonical },
      about: { '@id': orgId },
      mainEntity: c.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
  }
  const jsonLd = { '@context': 'https://schema.org', '@graph': graph }

  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'de-CH'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(company.name)}">
<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'de_CH'}">
<meta property="article:modified_time" content="${esc(today)}">
${fontLinksHtml(palette)}
${jsonLdScript(jsonLd)}
<style>${css}</style>
</head>
<body>

${headerHtml(company, site, navCtaText, opts.rendered, structure?.logoText)}

<header class="hero">
  <div class="wrap">
    <h1>${esc(c.heroTitle)}</h1>
    <p class="lead">${esc(c.heroLead)}</p>
    <p class="updated">${esc(freshnessLine(lang, today))}</p>
    <div class="actions">
      <a class="btn" href="${esc(site)}">${esc(navCtaText)}</a>
      ${secondaryAction}
    </div>
    ${statsHtml}
  </div>
</header>

${body}

<section id="kontakt">
  <div class="wrap">
    <div class="cta">
      ${h2Html(c.ctaTitle)}
      <p>${esc(c.ctaText)}</p>
      <div class="actions">
        <a class="btn" href="${esc(site)}">${esc(navCtaText)}</a>
      </div>
    </div>
  </div>
</section>

${footerHtml(company, site, lang, opts.siblings)}

</body>
</html>`
}

/** Hub page in the same design system (measured client design when available). */
export function renderIndex(
  company: Company,
  pages: { filename: string; title: string; teaser: string }[],
  design?: {
    rendered?: RenderedDesign | null
    designTokens?: DesignTokens | null
    structure?: SiteStructure | null
  },
): string {
  const palette = resolvePalette(design?.rendered, design?.designTokens)
  const css = cssFromPalette(palette)
  const ctaText =
    design?.structure?.ctaText ?? design?.rendered?.headerButton?.text ?? 'Kontakt'
  const lang = company.language === 'en' ? 'en' : 'de'
  const today = new Date().toISOString().slice(0, 10)
  const site = company.website.replace(/\/$/, '')
  // The index deploys as the pack-folder root on the MAIN domain.
  const canonical = packUrl(company, 'index.html')
  const cards = pages
    .map(
      (p) => `<a class="card" href="${esc(p.filename)}" style="display:block;color:inherit">
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.teaser)}</p>
  </a>`,
    )
    .join('\n  ')

  // Organization + CollectionPage(ItemList of the generated pages) — mirrors
  // the @graph pattern used on content pages so this index is just as
  // fetchable/extractable, not a plain unstructured link list.
  const orgId = `${site}#organization`
  const graph: unknown[] = [
    { '@type': 'Organization', '@id': orgId, name: company.name, url: site },
    {
      '@type': 'CollectionPage',
      '@id': canonical,
      url: canonical,
      name: `Wissen & Antworten — ${company.name}`,
      inLanguage: lang === 'en' ? 'en' : 'de-CH',
      dateModified: today,
      about: { '@id': orgId },
      hasPart: {
        '@type': 'ItemList',
        itemListElement: pages.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: p.title,
          url: packUrl(company, p.filename),
        })),
      },
    },
  ]

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wissen &amp; Themen — ${esc(company.name)}</title>
<meta name="description" content="Antworten und Wissen zu ${esc(company.sector)} — von ${esc(company.name)}, ${esc(company.location)}.">
<link rel="canonical" href="${esc(canonical)}">
${fontLinksHtml(palette)}
${jsonLdScript({ '@context': 'https://schema.org', '@graph': graph })}
<style>${css}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:28px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:${palette.cardRadius};padding:26px}
.card h3{font-size:17px;margin-bottom:10px;color:var(--text)}
.card p{font-size:14.5px;margin:0;color:var(--muted)}
.updated{font-size:13px;color:var(--muted);margin-top:10px}
</style>
</head>
<body>
${headerHtml(company, company.website, ctaText, design?.rendered, design?.structure?.logoText)}
<header class="hero">
  <div class="wrap">
    <h1>Wissen &amp; <em>Antworten</em></h1>
    <p class="lead">Die häufigsten Fragen zu ${esc(company.sector)} — klar beantwortet von ${esc(company.name)}, ${esc(company.location)}.</p>
    <p class="updated">${esc(freshnessLine(lang, today))}</p>
  </div>
</header>
<section>
  <div class="wrap">
    <div class="cards">
  ${cards}
    </div>
  </div>
</section>
${footerHtml(company, company.website, company.language, [])}
</body>
</html>`
}
