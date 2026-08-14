import { useId } from 'react'
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'

/**
 * Sparkline — 44px tall, #8FB4F2 stroke, soft gradient fill, hidden axes,
 * animation off. Returns null for fewer than 2 points (a single point is
 * not a trend).
 */
export function Sparkline({
  data,
  stroke = '#8FB4F2',
  className,
}: {
  /** Series values in chronological order (any unit — normalized internally). */
  data: number[]
  stroke?: string
  className?: string
}) {
  // Unique gradient id per instance so multiple sparklines never collide.
  const gradientId = useId()

  if (data.length < 2) return null

  const points = data.map((v, i) => ({ i, v }))

  return (
    <div className={className} style={{ height: 44 }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
