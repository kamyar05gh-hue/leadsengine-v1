import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'

// SummaryTile — clickable navigation card: 10px uppercase label with a
// corner ArrowUpRight, a 26px tabular metric, an optional sparkline, and a
// truncated 12px takeaway. Hover (via .tile): border + lift; label goes to
// #A6A6AF and the arrow shifts up-right into #8FB4F2.
export function SummaryTile({
  label,
  metric,
  takeaway,
  sparkline,
  onClick,
}: {
  label: string
  metric: string
  takeaway: string
  sparkline?: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="tile group w-full p-5 text-left">
      <div className="flex items-center justify-between gap-3">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] transition-colors duration-150 group-hover:text-[#A6A6AF]">
          {label}
        </div>
        <ArrowUpRight
          size={16}
          strokeWidth={1.5}
          className="shrink-0 text-[#5C5C66] transition-[color,transform] duration-150 group-hover:translate-x-[1px] group-hover:-translate-y-[1px] group-hover:text-[#8FB4F2]"
        />
      </div>
      <div className="mt-3 text-[26px] font-medium tabular-nums text-white">{metric}</div>
      {sparkline && <div className="mt-2">{sparkline}</div>}
      <div className="mt-2 truncate text-[12px] text-[#5C5C66]" title={takeaway}>
        {takeaway}
      </div>
    </button>
  )
}
