export const STAT_TONE = {
  // Positive/healthy tone — light purple accent (key kept as 'green' so the
  // semantic call sites and API payloads stay stable).
  green: '#A78BFA',
  red: '#F06A6A',
  gray: '#8A8A93',
  white: '#FFFFFF',
} as const

export type StatTone = keyof typeof STAT_TONE

import { AnimatedValue } from './AnimatedValue'

// StatBox — 10px uppercase label, 24px tabular value, 12px optional delta.
// The delta is the one place text may wear a series (signed) color.
// The value counts up on first render (reduced-motion safe).
export function StatBox({
  label,
  value,
  delta,
  tone = 'gray',
}: {
  label: string
  value: string
  delta?: string
  tone?: StatTone
}) {
  return (
    <div className="rounded-[12px] border border-[#1C1C21] bg-[#0B0B0D] px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
        {label}
      </div>
      <div className="mt-2.5 text-[24px] font-medium tabular-nums text-white">
        <AnimatedValue value={value} />
      </div>
      {delta && (
        <div
          className="mt-1.5 text-[12px] tabular-nums"
          style={{ color: STAT_TONE[tone] }}
        >
          {delta}
        </div>
      )}
    </div>
  )
}
