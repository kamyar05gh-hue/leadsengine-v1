/**
 * Agent: design cloner — resolves the client's full design exactly once per
 * company and caches it, so a job building ten pages pays for one Playwright
 * run.
 *
 *   rendered  — extractRenderedDesign(): computed styles from the RENDERED
 *               DOM (works on fully client-rendered sites like Wix): exact
 *               colors/fonts/buttons/palette/logo. Source of truth.
 *   tokens    — analyzeScreenshots() turns the screenshot set into
 *               DesignTokens via Gemini Vision (fills gaps only — measured
 *               facts override vision guesses).
 *   visionNotes — describeDesignFromScreenshots(): qualitative layout /
 *               spacing / imagery / tone description.
 *   structure — fetchSiteStructure() (plain fetch), with a rendered-DOM
 *               fallback for client-rendered sites.
 *   masterPrompt — composeMasterStylePrompt() merges measured + vision into
 *               the per-company MASTER STYLE PROMPT, persisted under
 *               reports/<companyId>/master-style.json and injected into
 *               every page-generating LLM call.
 *
 * Cache layers: in-memory Map for the process, plus a JSON file under
 * server/assets/designs/{companyId}.json so restarts reuse yesterday's
 * extraction. Every layer degrades gracefully — a failed extraction yields
 * null fields and pageShell renders the standard FM shell (never a stub).
 */
import fs from 'node:fs'
import path from 'node:path'
import { PATHS } from '../config.js'
import type { Company } from '../types.js'
import { extractLiveDesign, fetchSiteStructure, type RenderedDesign } from './designExtractor.js'
import {
  analyzeScreenshots,
  describeDesignFromScreenshots,
  type DesignTokens,
} from './visionAnalyzer.js'
import { composeMasterStylePrompt, saveMasterStyle } from './brandStyle.js'
import type { SiteStructure } from './siteStructure.js'

export interface ClientDesign {
  tokens: DesignTokens | null
  structure: SiteStructure | null
  /** Measured computed-style design from the rendered DOM (source of truth). */
  rendered: RenderedDesign | null
  /** Vision model's qualitative layout/imagery/tone notes. */
  visionNotes: string | null
  /** The merged master style prompt for page-generating LLM calls. */
  masterPrompt: string | null
}

const memCache = new Map<string, ClientDesign>()

function cacheFile(companyId: string): string {
  const safe = companyId.replace(/[^a-z0-9_-]/gi, '_')
  return path.join(PATHS.root, 'assets', 'designs', `${safe}.json`)
}

/**
 * Loose shape check. Requires the `rendered` key so cache files written
 * before computed-style extraction existed are treated as a miss and
 * re-extracted with the full pipeline.
 */
function isClientDesign(v: unknown): v is ClientDesign {
  return (
    typeof v === 'object' &&
    v !== null &&
    'tokens' in v &&
    'structure' in v &&
    'rendered' in v &&
    'masterPrompt' in v
  )
}

function readFileCache(companyId: string): ClientDesign | null {
  try {
    const raw = fs.readFileSync(cacheFile(companyId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isClientDesign(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeFileCache(companyId: string, design: ClientDesign): void {
  try {
    const file = cacheFile(companyId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(design, null, 2), 'utf8')
  } catch (err) {
    console.warn('[designCloner] could not write design cache:', err instanceof Error ? err.message : err)
  }
}

/** SiteStructure synthesized from the rendered DOM (client-rendered sites). */
function structureFromRendered(r: RenderedDesign): SiteStructure {
  return {
    navLinks: [],
    ctaText: r.headerButton?.text ?? r.primaryButton?.text ?? null,
    logoText: r.logo?.alt || r.siteTitle || null,
    footerColumns: [],
    sectionOrder: [],
    homeDescription: r.metaDescription,
  }
}

/**
 * Clone the client's design: measured computed styles + vision analysis from
 * screenshots + structure. Cached per company (memory + JSON file); a fully
 * failed extraction is cached too — it is not retried within the process
 * (the pageShell fallback is the intended outcome).
 */
export async function cloneClientDesign(company: Company): Promise<ClientDesign> {
  const mem = memCache.get(company.id)
  if (mem) return mem
  const disk = readFileCache(company.id)
  if (disk) {
    memCache.set(company.id, disk)
    return disk
  }

  // Structure first — a plain fetch, cheap and independent of Playwright.
  let structure = await fetchSiteStructure(company.website)

  // One Playwright pass: screenshots (vision input) + rendered computed styles.
  const { shots, rendered } = await extractLiveDesign(company.website)

  // Client-rendered site with an empty plain-fetch structure → synthesize
  // the essentials (CTA text, logo text, meta description) from the DOM.
  if (rendered && (!structure || (structure.navLinks.length === 0 && !structure.homeDescription))) {
    structure = structureFromRendered(rendered)
  }

  let tokens: DesignTokens | null = null
  let visionNotes: string | null = null
  if (shots) {
    ;[tokens, visionNotes] = await Promise.all([
      analyzeScreenshots(shots.paths),
      describeDesignFromScreenshots(shots.paths),
    ])
  }

  const masterPrompt =
    rendered || visionNotes ? composeMasterStylePrompt(company, rendered, visionNotes) : null
  if (masterPrompt) {
    saveMasterStyle({
      companyId: company.id,
      website: company.website,
      extractedAt: new Date().toISOString(),
      rendered,
      visionNotes,
      prompt: masterPrompt,
    })
  }

  const design: ClientDesign = { tokens, structure, rendered, visionNotes, masterPrompt }
  memCache.set(company.id, design)
  writeFileCache(company.id, design)
  return design
}

/** Drop the cached design for one company (e.g. after a rebranding). */
export function clearClientDesignCache(companyId: string): void {
  memCache.delete(companyId)
  try {
    fs.rmSync(cacheFile(companyId), { force: true })
  } catch {
    // best-effort
  }
}
