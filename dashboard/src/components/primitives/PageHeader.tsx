import type { ReactNode } from 'react'
import { STAT_TONE, type StatTone } from './StatBox'
import { AnimatedValue } from './AnimatedValue'

export interface HeaderStat {
  label: string
  value: string
  tone?: StatTone
  sub?: string
}

// PageHeader — every page starts with this. Kicker → title → description
// on the left, a horizontal stat cluster on the right. Stat values count up
// on first render; `titleAdornment` sits beside the title (e.g. the client
// visibility ring).
export function PageHeader({
  kicker,
  title,
  titleAdornment,
  description,
  stats,
}: {
  kicker: string
  title: string
  titleAdornment?: ReactNode
  description: string
  stats?: HeaderStat[]
}) {
  return (
    <div className="rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] px-7 py-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#7C9BD4]">
            {kicker}
          </div>
          <div className="mt-2 flex items-center gap-3.5">
            <h1 className="min-w-0 text-[28px] font-medium leading-tight text-white">{title}</h1>
            {titleAdornment}
          </div>
          <p className="mt-2 max-w-[620px] text-[13px] leading-relaxed text-[#8A8A93]">
            {description}
          </p>
        </div>
        {stats && stats.length > 0 && (
          <div className="flex items-start gap-8">
            {stats.map((s) => (
              <div key={s.label} className="min-w-[90px]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                  {s.label}
                </div>
                <div
                  className="mt-1.5 text-[22px] font-medium tabular-nums"
                  style={{ color: STAT_TONE[s.tone ?? 'white'] }}
                >
                  <AnimatedValue value={s.value} />
                </div>
                {s.sub && <div className="mt-0.5 text-[11px] text-[#5C5C66]">{s.sub}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
