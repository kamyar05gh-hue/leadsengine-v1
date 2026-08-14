/**
 * render.ts — HTML → PDF via Playwright headless Chromium.
 *
 * A4, printBackground, zero margins (`@page` in the stylesheet owns the
 * geometry). The browser is launched once per batch and reused across
 * languages/variants — see `withBrowser`.
 */
import { chromium, type Browser } from 'playwright'

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch()
  try {
    return await fn(browser)
  } finally {
    await browser.close()
  }
}

/** Render one self-contained HTML document to an A4 PDF at `outPath`. */
export async function htmlToPdf(browser: Browser, html: string, outPath: string): Promise<void> {
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      scale: 1,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  } finally {
    await page.close()
  }
}
