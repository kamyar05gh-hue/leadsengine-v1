/**
 * executive/index.ts — Dark Executive Report orchestrator (v6).
 *
 * Input (per language + variant) → model → self-contained HTML with
 * TS-generated inline-SVG charts (svgCharts.ts) → headless-Chromium PDF.
 * Pure TypeScript end to end — the matplotlib chart farm is gone.
 */
import type { Browser } from 'playwright'

import { buildModel, type ExecInput } from './model.js'
import { buildExecutiveHtml } from './html.js'
import { htmlToPdf } from './render.js'

export { withBrowser } from './render.js'
export type { ExecInput } from './model.js'

/** Render one executive PDF (one language, one variant) to `outPath`. */
export async function renderExecutiveReport(
  browser: Browser,
  input: ExecInput,
  outPath: string,
): Promise<void> {
  const model = buildModel(input)
  const html = buildExecutiveHtml(model)
  await htmlToPdf(browser, html, outPath)
}
