/**
 * Agent: design applier — injects extracted design tokens into a rendered
 * pageShell template by rewriting its CSS, so a replicated page matches the
 * source site's design system without touching pageShell.ts itself.
 *
 * Works on the final HTML string: rewrites the `:root{...}` custom-property
 * values, the body font-family, the container max-width, and the section
 * padding. Anything unparseable in the tokens leaves the original CSS intact.
 */
import type { DesignTokens } from './visionAnalyzer.js'

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const LENGTH = /^\d+(?:\.\d+)?(?:px|rem|em|%)$/

/** Token → CSS custom property in the pageShell :root block. */
const VAR_MAP: Record<keyof DesignTokens['colors'], string> = {
  primary: '--blue',
  secondary: '--panel-alt',
  background: '--bg',
  text: '--text',
  accent: '--blue-soft',
}

/** Replace `--name:value` inside the :root block; no-op if name absent. */
function setVar(rootBlock: string, name: string, value: string): string {
  const re = new RegExp(`(${name.replace('-', '\\-')}:)[^;}]+`)
  return re.test(rootBlock) ? rootBlock.replace(re, `$1${value}`) : rootBlock
}

/**
 * Return `shellTemplate` with the design tokens baked into its inline CSS.
 * The input is the HTML produced by pageShell.renderPage/renderIndex; the
 * output is the same HTML with the source site's design system applied.
 */
export function applyDesignTokens(designTokens: DesignTokens, shellTemplate: string): string {
  let out = shellTemplate

  // 1) Colors → :root custom properties.
  out = out.replace(/:root\{([^}]*)\}/, (match, block: string) => {
    let next = block
    for (const [token, cssVar] of Object.entries(VAR_MAP) as [keyof DesignTokens['colors'], string][]) {
      const value = designTokens.colors[token]
      if (HEX.test(value)) next = setVar(next, cssVar, value)
    }
    return `:root{${next}}`
  })

  // 2) Body font — keep the system fallbacks after the extracted family.
  const bodyFont = designTokens.typography.bodyFont.trim()
  if (bodyFont && !/[;{}<>]/.test(bodyFont)) {
    out = out.replace(
      /body\{([^}]*)font-family:[^;]+/,
      (match, before: string) => `body{${before}font-family:'${bodyFont}',Arial,sans-serif`,
    )
  }

  // 3) Container width + section padding.
  const maxWidth = designTokens.spacing.containerMaxWidth.trim()
  if (LENGTH.test(maxWidth)) {
    out = out.replace(/\.wrap\{max-width:[^;]+/, `.wrap{max-width:${maxWidth}`)
  }
  const sectionPadding = designTokens.spacing.sectionPadding.trim()
  if (LENGTH.test(sectionPadding)) {
    out = out.replace(/section\{padding:[^;}]+/, `section{padding:${sectionPadding} 0`)
  }

  return out
}
