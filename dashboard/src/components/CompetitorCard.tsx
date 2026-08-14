import type { CompetitorMetric } from '@/lib/api'

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

// CompetitorCard — nested surface with StatBox-style metrics (10px uppercase
// label, tabular value). Lives inside a Card, so it uses the inset step of
// the depth model: #0E0E11 with a #16161A border.
export function CompetitorCard({ competitor }: { competitor: CompetitorMetric }) {
  return (
    <div className="rounded-[12px] border border-[#16161A] bg-[#0E0E11] p-5">
      <div className="truncate text-[13px] font-medium text-[#C9C9D1]" title={competitor.name}>
        {competitor.name}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
            Mention rate
          </div>
          <div className="mt-1.5 text-[20px] font-medium tabular-nums text-white">
            {pct(competitor.mentionRate)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
            Citation rate
          </div>
          <div className="mt-1.5 text-[20px] font-medium tabular-nums text-white">
            {pct(competitor.citationRate)}
          </div>
        </div>
      </div>
    </div>
  )
}
