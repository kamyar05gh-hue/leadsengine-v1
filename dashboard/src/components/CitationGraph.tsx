import type { CitationDomain } from '@/lib/api'
import { SERIES } from '@/components/primitives/chartTheme'

const COMPETITOR_BAR = '#3F3F47'
const TRACK = '#16161A'

/**
 * CitationGraph — ranked domains, each with two horizontal bars: citations
 * of the company (series blue) vs. citations of competitors (quiet gray).
 */
export function CitationGraph({
  domains,
  limit = 12,
}: {
  domains: CitationDomain[]
  limit?: number
}) {
  if (domains.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[#5C5C66]">
        No citation data yet.
      </div>
    )
  }

  const rows = [...domains]
    .sort((a, b) => b.companyCitations + b.competitorCitations - (a.companyCitations + a.competitorCitations))
    .slice(0, limit)
  const max = Math.max(...rows.map((d) => Math.max(d.companyCitations, d.competitorCitations)), 1)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 text-[12px] text-[#8A8A93]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SERIES[0] }} /> Company
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COMPETITOR_BAR }} /> Competitors
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map((d) => (
          <div key={d.domain} className="grid grid-cols-[160px_1fr] items-center gap-3 sm:grid-cols-[220px_1fr]">
            <div className="truncate text-[12px] text-[#8A8A93]" title={d.domain}>
              {d.domain}
            </div>
            <div className="flex flex-col gap-1">
              <Bar value={d.companyCitations} max={max} color={SERIES[0]} />
              <Bar value={d.competitorCitations} max={max} color={COMPETITOR_BAR} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%`,
            backgroundColor: value > 0 ? color : '#1C1C21',
          }}
        />
      </div>
      <span className="w-6 text-right text-[12px] tabular-nums text-[#5C5C66]">{value}</span>
    </div>
  )
}
