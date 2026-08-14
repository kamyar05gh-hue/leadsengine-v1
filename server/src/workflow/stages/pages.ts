/**
 * Stage: pages — render the action plan into an FTP-ready "AI crawl pack".
 *
 * Scrapes the client's live site for its brand style AND crawls its real
 * page content (siteCrawler), then builds one HTML page per planned PageSpec
 * (cheap labor models, deterministic fallback), plus the pack layer:
 * index.html, a consolidated faq.html (+ faq.json), a site-wide graph.jsonld
 * and website.md carrying the REAL crawled main-site content, sitemap.xml
 * (pack-only), llms.txt, robots.txt and DEPLOY.md.
 * All URLs are anchored at https://<main-domain>/<PACK_FOLDER>/ — the pack
 * deploys as a FOLDER on the client's main domain (a folder inherits the
 * domain's authority; a subdomain starts from zero). Files land in
 * PATHS.reports/<companyId>/site/ and are registered in the reports table
 * (kind 'page') so the dashboard can list them.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getBrandProfile } from '../../agents/brandStyle.js'
import { cloneClientDesign } from '../../agents/designCloner.js'
import {
  buildDeployMd,
  buildFaqJson,
  buildFaqPage,
  buildIndex,
  buildLlmsTxt,
  buildPage,
  buildRobotsTxt,
  buildSitemapXml,
  buildSiteGraph,
  buildWebsiteMd,
  dedupeFaq,
  slugToFilename,
  type PackPageEntry,
} from '../../agents/pageBuilder.js'
import { fallbackCompanyFaq, writeCompanyFaq } from '../../agents/pageContentWriter.js'
import { getSiteCrawl } from '../../agents/siteCrawler.js'
import { PATHS } from '../../config.js'
import { insertReport, latestActionPlan } from '../../db/repo.js'
import type { Company } from '../../types.js'

export async function runPages(company: Company): Promise<number> {
  const plan = latestActionPlan(company.id)

  const brandProfile = await getBrandProfile(company)
  // Clone the client's design ONCE per company (rendered computed styles +
  // screenshots + structure + master style prompt, cached in memory and on
  // disk) — every buildPage below reuses it.
  const design = await cloneClientDesign(company)
  // Crawl the client's MAIN site (cached in reports/<id>/site-crawl.json,
  // 7-day TTL) — the real page content feeds graph.jsonld, website.md,
  // llms.txt and the company FAQ. null → profile-based fallback (logged
  // loudly by getSiteCrawl).
  const crawl = await getSiteCrawl(company)
  if (crawl) {
    for (const p of crawl.pages) {
      console.log(`[pages] ${company.id}: crawled ${p.url} — "${p.title ?? p.h1 ?? '?'}" (${p.text.length} chars)`)
    }
  }
  const dir = path.join(PATHS.reports, company.id, 'site')
  fs.mkdirSync(dir, { recursive: true })
  const now = new Date().toISOString()
  let written = 0

  if (plan && plan.pages.length > 0) {
    const files: { filename: string; content: string }[] = []
    const built = []
    for (const spec of [...plan.pages].sort((a, b) => a.priority - b.priority)) {
      const page = await buildPage(company, spec, brandProfile, plan.pages)
      // keep filenames deterministic regardless of model output
      built.push({ ...page, filename: slugToFilename(spec.slug) })
    }

    // Content-page entries for the site-wide files (graph, sitemap, llms.txt).
    const specByFile = new Map(plan.pages.map((s) => [slugToFilename(s.slug), s]))
    const contentEntries: PackPageEntry[] = built.map((p) => ({
      filename: p.filename,
      title: p.title ?? specByFile.get(p.filename)?.title ?? p.filename,
      description:
        p.description ?? specByFile.get(p.filename)?.answerCapsule.slice(0, 155) ?? '',
    }))

    // Consolidated AI FAQ: every page's Q&As (deduped by question) plus 6-10
    // company-level questions written once via the labor chain (deterministic
    // fallback — never a missing file).
    const companyFaq =
      (await writeCompanyFaq(company, {
        pages: contentEntries.map((e) => ({ title: e.title, description: e.description })),
        structure: design.structure,
        crawl,
      })) ?? fallbackCompanyFaq(company)
    const allFaq = dedupeFaq(companyFaq, ...built.map((p) => p.faq ?? []))
    const faqPage = buildFaqPage(company, allFaq, design)

    built.push(faqPage)
    built.push(buildIndex(company, built, plan.pages, design))
    for (const p of built) files.push({ filename: p.filename, content: p.html })

    // Site-wide pack files. The graph/llms/sitemap list the index first, then
    // the content pages, then the consolidated FAQ.
    const indexEntry: PackPageEntry = {
      filename: 'index.html',
      title: `Wissen & Antworten — ${company.name}`,
      description: `Übersicht aller Themen von ${company.name} — ${company.sector}, ${company.location}.`,
    }
    const faqEntry: PackPageEntry = {
      filename: faqPage.filename,
      title: faqPage.title ?? `Häufige Fragen zu ${company.name}`,
      description: faqPage.description ?? '',
    }
    const graphEntries = [indexEntry, ...contentEntries, faqEntry]
    // sitemap.xml stays pack-only — the main site has its own sitemap (noted
    // in DEPLOY.md); the crawled REAL pages live in graph.jsonld, website.md
    // and llms.txt instead.
    files.push({ filename: 'sitemap.xml', content: buildSitemapXml(company, graphEntries.map((e) => e.filename)) })
    files.push({ filename: 'graph.jsonld', content: buildSiteGraph(company, graphEntries, crawl) })
    files.push({ filename: 'faq.json', content: buildFaqJson(company, allFaq) })
    if (crawl && crawl.pages.length > 0) {
      // Markdown mirror of the real main site (kind 'page', listed in llms.txt).
      files.push({ filename: 'website.md', content: buildWebsiteMd(company, crawl) })
    } else {
      console.warn(
        `[pages] ${company.id}: NO site crawl — graph.jsonld/llms.txt fall back to profile-derived content, website.md skipped`,
      )
    }
    files.push({ filename: 'llms.txt', content: buildLlmsTxt(company, contentEntries, crawl) })
    files.push({ filename: 'robots.txt', content: buildRobotsTxt(company) })
    files.push({ filename: 'DEPLOY.md', content: buildDeployMd(company) })

    // Self-clean: remove files from earlier runs that this build no longer
    // produces. Action plans change between runs, and a stale page with an
    // outdated canonical would otherwise ship in the FTP pack forever
    // (observed: 8 pre-pack pages lingering beside the fresh build).
    const current = new Set(files.map((f) => f.filename))
    for (const existing of fs.readdirSync(dir)) {
      if (!current.has(existing)) {
        try {
          fs.rmSync(path.join(dir, existing))
          console.log(`[pages] ${company.id}: removed stale ${existing}`)
        } catch { /* locked file — non-fatal, next run retries */ }
      }
    }

    for (const f of files) {
      const p = path.join(dir, f.filename)
      fs.writeFileSync(p, f.content, 'utf8')
      insertReport({
        companyId: company.id,
        scope: 'regional', // site files are scope-agnostic; column reuse (same as playbook)
        lang: company.language,
        kind: 'page',
        path: p,
        createdAt: now,
      })
    }
    written += files.length
  }

  return written
}
