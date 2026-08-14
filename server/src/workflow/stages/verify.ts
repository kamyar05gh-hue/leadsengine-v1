/**
 * Stage: verify — citation verification.
 *
 * The audit stage records which URLs the AI engines *claimed* to cite; this
 * stage fetches each cited URL and checks the page actually mentions the
 * brand (via the citationVerifier agent). One row per URL is stored in
 * verified_citations, so the report can separate "cited" from "verified".
 *
 * Idempotent: records that already have verification rows are skipped, so a
 * retried job resumes where it stopped instead of re-fetching every URL.
 */
import { verifyCitationsBatch } from '../../agents/citationVerifier.js'
import { getAuditRecordCitations, listVerifiedCitations } from '../../db/repo.js'
import type { Company } from '../../types.js'

/** Aggregate result of the verify stage, reported back to the pipeline. */
export interface VerifySummary {
  /** Audit records that had at least one cited URL. */
  recordsWithCitations: number
  /** Records skipped because they were already verified (idempotent resume). */
  recordsSkipped: number
  /** Total cited URLs checked across all records. */
  urlsChecked: number
  /** URLs whose page actually mentions the brand. */
  verified: number
  /** URLs that could not be verified (no mention, or page unreachable). */
  failed: number
}

/**
 * Verify the cited URLs of every audit record for the company's prompt
 * library. Per-URL failures never abort the stage — verifyCitations stores
 * them as unverified rows. Progress is reported as (done, total) over the
 * records that carry citations.
 */
export async function runVerify(
  company: Company,
  libraryId: number,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<VerifySummary> {
  const records = getAuditRecordCitations(company.id, libraryId).filter(
    (r) => r.citedUrls.length > 0,
  )
  const total = records.length

  const summary: VerifySummary = {
    recordsWithCitations: total,
    recordsSkipped: 0,
    urlsChecked: 0,
    verified: 0,
    failed: 0,
  }
  if (total === 0) return summary

  // Resume guard: records with existing verification rows were handled by a
  // previous (partial) run — don't pay for their fetches again.
  const pending: typeof records = []
  for (const record of records) {
    if (listVerifiedCitations(record.id).length > 0) summary.recordsSkipped += 1
    else pending.push(record)
  }
  if (pending.length === 0) return summary

  // One batch for the whole audit: single browser, URLs deduplicated across
  // records, own-domain + most-cited URLs prioritized under a global cap.
  // (The old per-record loop launched a fresh Chromium per record and
  // re-fetched duplicate URLs — 2,421 fetches / 90 minutes on a 200-record
  // audit; the batch does the same audit in a few minutes.)
  const result = await verifyCitationsBatch(
    company.id,
    pending.map((r) => ({ id: r.id, citedUrls: r.citedUrls })),
    onProgress,
  )
  summary.urlsChecked = result.urlsFetched
  summary.verified = result.verified
  summary.failed = result.failed

  return summary
}
