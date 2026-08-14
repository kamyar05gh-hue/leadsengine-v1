/**
 * Agent: vision analyzer — sends the extractor's screenshots to Gemini
 * Vision (MODELS.laborVision, default gemini-2.5-pro) and parses the design
 * system (colors, typography, spacing, components, layout) out of the
 * response.
 *
 * Failure policy: never throw. Missing API key, HTTP errors, or unparseable
 * JSON all fall back to DEFAULT_DESIGN_TOKENS so downstream stages always
 * have a complete, usable token set.
 *
 * NOTE: the Gemini call path is built but not yet exercised against the live
 * API (key pending). Wire-up follows providers/gemini.ts conventions.
 */
import fs from 'node:fs'
import { KEYS, MODELS } from '../config.js'
import { errText, request } from '../providers/http.js'

export interface DesignTokens {
  colors: {
    primary: string
    secondary: string
    background: string
    text: string
    accent: string
  }
  typography: {
    headingFont: string
    bodyFont: string
    headingSizes: { h1: string; h2: string; h3: string }
    bodySize: string
    lineHeight: string
  }
  spacing: {
    sectionPadding: string
    containerMaxWidth: string
    gridGap: string
  }
  components: {
    buttonStyle: string
    cardStyle: string
    headerStyle: string
  }
  layout: {
    heroStructure: string
    sectionOrder: string[]
    navigationStyle: string
  }
}

/** Neutral dark-theme fallback (mirrors the pageShell palette). */
export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  colors: {
    primary: '#116dff',
    secondary: '#2b5672',
    background: '#1B1B1E',
    text: '#FFFFFF',
    accent: '#5E97FF',
  },
  typography: {
    headingFont: 'Helvetica Neue',
    bodyFont: 'Helvetica Neue',
    headingSizes: { h1: '48px', h2: '26px', h3: '17px' },
    bodySize: '16px',
    lineHeight: '1.65',
  },
  spacing: {
    sectionPadding: '64px',
    containerMaxWidth: '1080px',
    gridGap: '18px',
  },
  components: {
    buttonStyle: 'solid primary background, white text, 8px radius, 600 weight',
    cardStyle: 'panel background, 1px border, 14px radius, 26px padding',
    headerStyle: 'sticky, 64px height, translucent dark background with blur',
  },
  layout: {
    heroStructure: 'centered h1 + lead + dual CTA + stat strip',
    sectionOrder: ['hero', 'features', 'testimonials', 'faq', 'cta'],
    navigationStyle: 'sticky top bar, brand left, links right, CTA button',
  },
}

const PROMPT = `Analyze these website screenshots and extract the complete design system.
Return ONLY valid JSON with this structure:
{
  "colors": {
    "primary": "#hex",
    "secondary": "#hex",
    "background": "#hex",
    "text": "#hex",
    "accent": "#hex"
  },
  "typography": {
    "headingFont": "font name or fallback",
    "bodyFont": "font name or fallback",
    "headingSizes": {"h1": "px", "h2": "px", "h3": "px"},
    "bodySize": "px",
    "lineHeight": "number"
  },
  "spacing": {
    "sectionPadding": "px",
    "containerMaxWidth": "px",
    "gridGap": "px"
  },
  "components": {
    "buttonStyle": "description of button design",
    "cardStyle": "description of card design",
    "headerStyle": "fixed/sticky, height, background"
  },
  "layout": {
    "heroStructure": "description",
    "sectionOrder": ["hero", "features", "testimonials", "..."],
    "navigationStyle": "description"
  }
}`

interface GeminiVisionBody {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

/** Strip ```json fences and extract the first {...} block. */
function parseTokenJson(text: string): Partial<DesignTokens> | null {
  const cleaned = text.replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Partial<DesignTokens>
  } catch {
    return null
  }
}

/** Deep-merge partial LLM output over the defaults — partial JSON still yields full tokens. */
function mergeWithDefaults(partial: Partial<DesignTokens> | null): DesignTokens {
  if (!partial) return DEFAULT_DESIGN_TOKENS
  const d = DEFAULT_DESIGN_TOKENS
  return {
    colors: { ...d.colors, ...partial.colors },
    typography: {
      ...d.typography,
      ...partial.typography,
      headingSizes: { ...d.typography.headingSizes, ...partial.typography?.headingSizes },
    },
    spacing: { ...d.spacing, ...partial.spacing },
    components: { ...d.components, ...partial.components },
    layout: {
      ...d.layout,
      ...partial.layout,
      sectionOrder:
        Array.isArray(partial.layout?.sectionOrder) && partial.layout.sectionOrder.length > 0
          ? partial.layout.sectionOrder.map(String)
          : d.layout.sectionOrder,
    },
  }
}

/** Shared Gemini vision call: prompt + PNGs → response text, null on failure. */
async function geminiVision(prompt: string, screenshotPaths: string[], maxTokens: number): Promise<string | null> {
  if (!KEYS.gemini) return null
  const images = screenshotPaths.filter((p) => fs.existsSync(p))
  if (images.length === 0) return null

  const parts: unknown[] = [{ text: prompt }]
  for (const p of images) {
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: fs.readFileSync(p).toString('base64'),
      },
    })
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.laborVision}:generateContent?key=${KEYS.gemini}`
  const { status, body } = await request('POST', url, {
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
  })
  if (status !== 200) {
    console.warn(`[visionAnalyzer] Gemini vision failed — HTTP ${status}: ${errText(body)}`)
    return null
  }
  let text = ''
  const b = body as unknown as GeminiVisionBody
  for (const part of b.candidates?.[0]?.content?.parts ?? []) text += part.text ?? ''
  return text || null
}

/**
 * Analyze screenshots with Gemini Vision (MODELS.laborVision) and return
 * design tokens.
 * Returns DEFAULT_DESIGN_TOKENS on any failure (no key, HTTP error, bad JSON).
 */
export async function analyzeScreenshots(screenshotPaths: string[]): Promise<DesignTokens> {
  const text = await geminiVision(PROMPT, screenshotPaths, 4000)
  if (!text) return DEFAULT_DESIGN_TOKENS
  const parsed = parseTokenJson(text)
  if (!parsed) {
    console.warn('[visionAnalyzer] could not parse Gemini response as JSON. Using defaults.')
    return DEFAULT_DESIGN_TOKENS
  }
  return mergeWithDefaults(parsed)
}

const DESCRIBE_PROMPT = `These screenshots show one company's live website (full page + sections at several viewports).
Describe its VISUAL DESIGN SYSTEM precisely, as instructions for a developer who must build a landing page that is visually indistinguishable from this site. Cover:

1. LAYOUT STRUCTURE: header composition, hero structure (alignment, media, overlay), how content sections are composed (cards? full-bleed? max content width), footer structure.
2. SPACING RHYTHM: how generous the vertical spacing between sections is, padding inside cards, density of the layout.
3. IMAGERY & GRAPHIC STYLE: photography style, video, illustrations, gradients, glows, decorative shapes, borders, shadows, corner radii.
4. TYPOGRAPHY FEEL: display vs body contrast, heading case and weight, any signature detail (e.g. accent-colored punctuation or words inside headings).
5. TONE: the overall mood (e.g. bold/minimal/dark/premium/playful) and copy style visible in the screenshots.
6. DO / DON'T rules: 5-8 concrete rules a cloned page must follow to pass as part of this site.

Be concrete and observational. Plain text, max 350 words. NO color hex guesses and NO font-name guesses — exact colors/fonts are measured elsewhere; describe structure, rhythm and mood only.`

/**
 * Describe the site's layout structure, spacing rhythm, imagery style and
 * tone from screenshots (Gemini Vision, MODELS.laborVision). This is the
 * qualitative half of the master style prompt; computed-style facts from the
 * rendered DOM always override anything stated here.
 * Returns null on any failure.
 */
export async function describeDesignFromScreenshots(screenshotPaths: string[]): Promise<string | null> {
  const text = await geminiVision(DESCRIBE_PROMPT, screenshotPaths, 2000)
  return text ? text.trim() : null
}
