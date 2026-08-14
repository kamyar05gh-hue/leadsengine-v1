/**
 * Agent: brand style — two jobs:
 *
 * 1. getBrandProfile(): fetch the client's live website and compress its
 *    visual identity into a compact "brand profile" string (zero LLM, pure
 *    fetch + regex). Fallback profile when the site is unreachable.
 *
 * 2. MASTER STYLE PROMPT: composeMasterStylePrompt() merges the MEASURED
 *    rendered-DOM design (designExtractor.extractRenderedDesign — exact hex
 *    values, exact font stacks, exact button styles) with the vision model's
 *    qualitative layout/tone description into ONE comprehensive style prompt
 *    that is injected into every page-generating LLM call and drives the
 *    pageShell CSS. Measured facts always override vision guesses.
 *    Persisted per company at reports/<companyId>/master-style.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { MOCK_PROVIDERS, PATHS } from '../config.js'
import type { Company } from '../types.js'
import type { ButtonProbe, RenderedDesign } from './designExtractor.js'

const FETCH_TIMEOUT_MS = 15_000
const MAX_CSS_CHARS = 2_000

/** Built-in fallback: Future Media dark theme (matches the PDF template). */
const FALLBACK_PROFILE = [
  'BRAND PROFILE (fallback — site unreachable):',
  '- Background: pitch black #0A0A0C, panels deep charcoal #141419',
  '- Primary: royal deep purple #6B21A8 / #7C3AED (headings, buttons, accents)',
  '- Accent: electric blue #2563EB (links, key metrics, borders)',
  '- Text: off-white #F4F4F5, muted #9CA3AF',
  '- Font: Inter, system-ui, sans-serif; flat design, generous spacing, rounded-xl cards, no gradients except subtle purple glow',
].join('\n')

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LeadEngine-BrandBot/1.0', Accept: 'text/html,text/css' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Pull the signals a page builder needs from raw HTML/CSS. */
function extractProfile(html: string, css: string, siteUrl: string): string {
  const title = /<title[^>]*>([^<]{3,120})<\/title>/i.exec(html)?.[1]?.trim() ?? ''

  // hex colors, frequency-ranked (top 12) — the palette
  const colorHits = new Map<string, number>()
  for (const m of (html + '\n' + css).matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = m[0].toLowerCase()
    colorHits.set(hex, (colorHits.get(hex) ?? 0) + 1)
  }
  const palette = [...colorHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([hex]) => hex)

  // fonts — font-family declarations + Google Fonts links
  const fonts = new Set<string>()
  for (const m of (html + '\n' + css).matchAll(/font-family:\s*([^;}]{3,80})/gi)) {
    fonts.add(m[1]?.trim().split(',')[0]?.replace(/["']/g, '') ?? '')
  }
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"&']+)/gi)) {
    fonts.add(decodeURIComponent(m[1] ?? '').split(':')[0]?.replace(/\+/g, ' ') ?? '')
  }
  fonts.delete('')

  // inline <style> blocks + fetched CSS, trimmed — concrete rules to imitate
  const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]{20,4000}?)<\/style>/gi)]
    .map((m) => m[1] ?? '')
    .join('\n')
  const cssSample = (inlineCss + '\n' + css)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_CSS_CHARS)

  const dark = /#0[0-9a-f]{5}|#1[0-9a-f]{5}|background[^;]{0,40}(black|dark)/i.test(html + css)

  return [
    `BRAND PROFILE (scraped live from ${siteUrl}):`,
    `- Site title: ${title}`,
    `- Theme: ${dark ? 'dark' : 'light'} (verify against palette)`,
    `- Dominant hex colors (frequency-ranked): ${palette.join(', ') || 'none detected'}`,
    `- Fonts: ${[...fonts].slice(0, 4).join(', ') || 'system default'}`,
    `- Real CSS rules from the site (imitate these, do not invent a new style):`,
    cssSample || '(no CSS extracted — use palette + theme above)',
  ].join('\n')
}

/**
 * Build the brand profile for a company. In mock mode (dry runs) no network
 * is touched — the fallback profile is returned directly.
 */
export async function getBrandProfile(company: Company): Promise<string> {
  if (MOCK_PROVIDERS) return FALLBACK_PROFILE
  const base = company.website.startsWith('http') ? company.website : `https://${company.website}`
  const html = await fetchText(base)
  if (!html) return FALLBACK_PROFILE

  // fetch up to 2 linked stylesheets (absolute-ized)
  const hrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
    .filter((h): h is string => Boolean(h))
    .slice(0, 2)
  let css = ''
  for (const href of hrefs) {
    const abs = href.startsWith('http') ? href : new URL(href, base).toString()
    css += (await fetchText(abs)) ?? ''
  }
  const profile = extractProfile(html, css, base)
  // sanity: if extraction found nothing at all, fall back
  return profile.includes('none detected') && profile.includes('no CSS extracted')
    ? FALLBACK_PROFILE
    : profile
}

// ─── Master style prompt (measured design + vision description) ─────────────

/** Persisted per-company style artifact. */
export interface MasterStyleArtifact {
  companyId: string
  website: string
  extractedAt: string
  /** The measured rendered-DOM design (source of truth). */
  rendered: RenderedDesign | null
  /** Vision model's qualitative layout/imagery/tone description. */
  visionNotes: string | null
  /** The merged master style prompt injected into page-generating LLM calls. */
  prompt: string
}

function masterStyleFile(companyId: string): string {
  const safe = companyId.replace(/[^a-z0-9_-]/gi, '_')
  return path.join(PATHS.reports, safe, 'master-style.json')
}

/** 'rgb(206, 203, 246)' / 'rgba(38,33,92,0.15)' → '#cecbf6' (alpha noted separately). */
export function rgbToHex(color: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(color)
  if (!m) return color
  const hex = [m[1], m[2], m[3]]
    .map((v) => Number(v).toString(16).padStart(2, '0'))
    .join('')
  const alpha = m[4] !== undefined ? Number(m[4]) : 1
  return alpha >= 0.99 ? `#${hex}` : `#${hex} (alpha ${alpha})`
}

function describeButton(label: string, b: ButtonProbe | null): string | null {
  if (!b) return null
  return (
    `- ${label}: background ${rgbToHex(b.background)}, text ${rgbToHex(b.textColor)}, ` +
    `border ${b.border.replace(/rgb\([^)]+\)/g, (c) => rgbToHex(c))}, radius ${b.borderRadius}, ` +
    `font ${b.fontFamily.split(',')[0]?.replace(/["']/g, '')} ${b.fontWeight} ${b.fontSize}, ` +
    `text-transform ${b.textTransform}, height ~${b.height}px (e.g. "${b.text}")`
  )
}

function describeElement(label: string, e: { fontFamily: string; fontSize: string; fontWeight: string; letterSpacing: string; color: string; textTransform: string; lineHeight: string } | null): string | null {
  if (!e) return null
  return (
    `- ${label}: ${e.fontFamily.split(',')[0]?.replace(/["']/g, '')} ${e.fontWeight}, ${e.fontSize}/${e.lineHeight}, ` +
    `color ${rgbToHex(e.color)}, letter-spacing ${e.letterSpacing}, text-transform ${e.textTransform}`
  )
}

/**
 * Merge the measured rendered design and the vision description into ONE
 * comprehensive master style prompt. Concrete: exact hex values, exact font
 * stacks, exact radii, spacing and do/don't rules. Measured facts are listed
 * as HARD FACTS that override the vision section on any conflict.
 */
export function composeMasterStylePrompt(
  company: Company,
  rendered: RenderedDesign | null,
  visionNotes: string | null,
): string {
  const L: string[] = [
    `MASTER STYLE PROMPT — ${company.name} (${company.website})`,
    `Generated pages MUST be visually indistinguishable from this site. Facts below are MEASURED from the rendered live site (computed styles); they OVERRIDE any conflicting guess, including the vision notes at the end.`,
    '',
  ]
  if (rendered) {
    const el = rendered.elements
    L.push('== MEASURED HARD FACTS (computed styles from the rendered DOM) ==')
    L.push(`- Page background: ${rgbToHex(rendered.pageBackground)}`)
    if (rendered.bgPalette.length > 0)
      L.push(`- Background palette (ranked by painted area): ${rendered.bgPalette.slice(0, 8).map((p) => rgbToHex(p.color)).join(', ')}`)
    if (rendered.textPalette.length > 0)
      L.push(`- Text palette (ranked by painted area): ${rendered.textPalette.slice(0, 8).map((p) => rgbToHex(p.color)).join(', ')}`)
    if (rendered.headingFontStack) L.push(`- Heading font stack: ${rendered.headingFontStack}`)
    if (rendered.bodyFontStack) L.push(`- Body font stack: ${rendered.bodyFontStack}`)
    for (const [label, probe] of [
      ['H1', el.h1],
      ['H2', el.h2],
      ['H3', el.h3],
      ['Paragraph', el.p],
      ['Link', el.a],
    ] as const) {
      const d = describeElement(label, probe)
      if (d) L.push(d)
    }
    const btns = [
      describeButton('PRIMARY button (filled)', rendered.primaryButton),
      describeButton('GHOST button (outlined)', rendered.ghostButton),
      describeButton('HEADER CTA button', rendered.headerButton),
    ].filter(Boolean) as string[]
    if (btns.length > 0) L.push('BUTTON STYLES (copy exactly — radius, colors, font):', ...btns)
    if (rendered.sectionBackgrounds.length > 0)
      L.push(`- Section background bands top→bottom: ${rendered.sectionBackgrounds.map(rgbToHex).join(' → ')}`)
    if (rendered.logo) L.push(`- Logo image URL: ${rendered.logo.src} (${rendered.logo.width}x${rendered.logo.height}, alt "${rendered.logo.alt}")`)
    if (rendered.fontsLoaded.length > 0) L.push(`- Loaded font faces: ${rendered.fontsLoaded.join(', ')}`)
    L.push('')
  } else {
    L.push('(No rendered-DOM measurement available — rely on the vision notes below.)', '')
  }
  if (visionNotes) {
    L.push('== VISION NOTES (layout structure, spacing rhythm, imagery, tone — from screenshots) ==')
    L.push(visionNotes)
    L.push('')
  }
  L.push('== NON-NEGOTIABLE RULES ==')
  L.push('- Use ONLY colors from the measured palettes above; never invent new brand colors.')
  L.push('- Use the exact measured font families (with sensible web fallbacks) and the measured button radius/colors.')
  L.push('- Match the site\'s heading case and weight exactly; keep the measured section background rhythm.')
  L.push('- DO NOT invent navigation menus, stock imagery, or components that do not exist on the real site.')
  return L.join('\n')
}

/** Persist the artifact under reports/<companyId>/master-style.json (+ .txt for humans). */
export function saveMasterStyle(artifact: MasterStyleArtifact): void {
  try {
    const file = masterStyleFile(artifact.companyId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(artifact, null, 2), 'utf8')
    fs.writeFileSync(file.replace(/\.json$/, '.txt'), artifact.prompt, 'utf8')
  } catch (err) {
    console.warn('[brandStyle] could not persist master style:', err instanceof Error ? err.message : err)
  }
}

/** Load a previously persisted master style artifact, null when absent/corrupt. */
export function loadMasterStyle(companyId: string): MasterStyleArtifact | null {
  try {
    const raw = fs.readFileSync(masterStyleFile(companyId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'prompt' in parsed && 'rendered' in parsed) {
      return parsed as MasterStyleArtifact
    }
    return null
  } catch {
    return null
  }
}
