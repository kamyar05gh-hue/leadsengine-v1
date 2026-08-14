/**
 * Impact model — turns audit metrics into the executive-summary CHF numbers.
 * Ported from leadengine/pdf_sales.py pain math, reconciled with
 * leadengine/impact.py.
 *
 * Assumption reconciliation: impact.py defined its own ASSUMPTIONS
 * (patient_value_chf=150k, monthly_ai_queries_bern=400, ctr_by_rank,
 * lead_conversion=0.08) and pdf_sales.py duplicated the same values as
 * module constants. config.IMPACT_ASSUMPTIONS wins — same values, single
 * source of truth. impact.py's per-rank CTR map is NOT ported: the pain
 * math the reports actually render (pdf_sales.py) uses the flat 35%
 * "answer surfaces a clickable practice link" share instead.
 *
 * Every figure is a MODELED ESTIMATE from these explicit assumptions —
 * never present the outputs as measured facts (footnoted in reports).
 */
import type { AuditRecord, Company, ImpactModel, OverallStats } from '../types.js'
import { IMPACT_ASSUMPTIONS } from '../config.js'
import { round0, round1, tierMention } from './scoring.js'

/** Share of answers that surface a clickable link (pdf_sales.py: `* 0.35`). */
const LINK_SURFACE = 0.35

/**
 * Pain math (pdf_sales.py, extended): the loss driver is the LARGER of
 *  (a) regional leakage — the gap between the client's best geography
 *      (home city tier) and their overall mention rate, and
 *  (b) the opportunity gap — top competitor SoV minus client SoV: demand
 *      the market leader provably captures that the client could contest.
 *      Without (b), a client invisible everywhere computes CHF 0 loss,
 *      which is mathematically true and commercially useless.
 *
 *   diverted    = monthly queries × gapShare × 35% link-surface share
 *   lostLeads   = diverted clicks × visit→inquiry conversion
 *   lostChf     = lost leads × average project value
 *
 * Competitor side: same formula, scaled by the top competitor's share of
 * voice (overall.topCompetitorSov, %) as the rival's relative share of
 * monthly queries where they capture the click instead.
 */
export function computeImpact(
  overall: OverallStats,
  records: AuditRecord[],
  company: Company,
): ImpactModel {
  const { projectValueChf, queriesPerMonth, ctrOther, conversion } = IMPACT_ASSUMPTIONS

  const cityRate = tierMention(records, 'tier', 'city', company)
  // Regional leakage: demand lost one tier out from the home city.
  const regionalGap = Math.max(0, cityRate - overall.mentionRate)
  // Opportunity gap: demand the leading competitor captures that the client
  // could contest — the honest loss figure for a client invisible everywhere
  // (regional leakage alone would compute CHF 0, which reads as "no problem").
  const sovGap = Math.max(0, overall.topCompetitorSov - overall.sov)
  const gapShare = Math.max(regionalGap, sovGap)
  const divertedClicksMonth = round0((queriesPerMonth * gapShare) / 100 * LINK_SURFACE)
  const lostLeadsMonth = round1(divertedClicksMonth * conversion)
  const lostChfMonth = round0(lostLeadsMonth * projectValueChf)

  const compDiverted = round0((queriesPerMonth * overall.topCompetitorSov) / 100 * LINK_SURFACE)
  const competitorLeadsMonth = round1(compDiverted * conversion)
  const competitorChfMonth = round0(competitorLeadsMonth * projectValueChf)

  return {
    divertedClicksMonth,
    lostLeadsMonth,
    lostChfMonth,
    competitorLeadsMonth,
    competitorChfMonth,
    assumptions: { projectValueChf, queriesPerMonth, ctrOther, conversion },
  }
}
