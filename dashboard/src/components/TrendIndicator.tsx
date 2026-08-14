const MINUS = '−' // U+2212

/**
 * TrendIndicator — a signed delta in text only: explicit + / Unicode minus,
 * positive #A78BFA (light purple) / red #F06A6A (flat: #5C5C66). Signed deltas are the one
 * place text may wear a series color.
 *
 * - `delta` is expressed in percentage points (e.g. 12 = "+12 pp").
 * - `invert` flips the color semantics for metrics where down is good.
 * - `null`/`undefined` renders nothing (no baseline = no trend).
 */
export function TrendIndicator({
  delta,
  unit = 'pp',
  invert = false,
  className,
}: {
  delta: number | null | undefined
  unit?: 'pp' | '%'
  invert?: boolean
  className?: string
}) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null

  const rounded = Math.round(Math.abs(delta))
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const good = invert ? direction === 'down' : direction === 'up'

  const color =
    direction === 'flat' ? '#5C5C66' : good ? '#A78BFA' : '#F06A6A'
  const sign = direction === 'up' ? '+' : direction === 'down' ? MINUS : ''
  const suffix = unit === 'pp' ? ' pp' : '%'

  return (
    <span className={`tabular-nums ${className ?? ''}`} style={{ color }}>
      {sign}
      {rounded}
      {suffix}
    </span>
  )
}
