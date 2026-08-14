import { useEffect, useState } from 'react'

const ACCENT = '#A78BFA'
const TRACK = '#16161A'

/**
 * Compact SVG progress ring for the client-detail header — shows the latest
 * mention rate at a glance next to the company name. The arc sweeps in on
 * mount via a stroke-dashoffset transition (`.ring-progress`, disabled under
 * prefers-reduced-motion so those users see the final state immediately).
 */
export function VisibilityRing({
  value,
  size = 46,
  label = 'Mention rate',
}: {
  /** Rate in 0..1; undefined renders an empty ring with an em dash. */
  value: number | undefined
  size?: number
  label?: string
}) {
  // Start the arc at 0 and flip to the real value one frame later so the
  // CSS transition has something to animate from.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setArmed(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const pct = value === undefined ? 0 : Math.max(0, Math.min(1, value))
  const strokeWidth = 3.5
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - (armed ? pct : 0))
  const text = value === undefined ? '—' : `${Math.round(pct * 100)}%`

  return (
    <div
      role="img"
      aria-label={`${label}: ${text}`}
      title={`${label}: ${text}`}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TRACK}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ACCENT}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="ring-progress"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-[#C9C9D1]">
        {text}
      </span>
    </div>
  )
}
