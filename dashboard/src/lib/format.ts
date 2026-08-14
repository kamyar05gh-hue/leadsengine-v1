// Number formatting is part of the design (§3):
// Unicode minus U+2212, explicit + on positive deltas, compact big numbers, 2dp %.

export const MINUS = '−' // U+2212

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? MINUS : ''
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`
  return `${sign}${abs}`
}

export function fmtPct(n: number, dp = 2): string {
  const v = n < 0 ? `${MINUS}${Math.abs(n).toFixed(dp)}` : n.toFixed(dp)
  return `${v}%`
}

// Signed delta: +4.2% / −6.10% (unit '%' or '')
export function fmtDelta(n: number, dp = 1, unit = '%'): string {
  if (n === 0) return `0.0${unit}`
  const body = `${Math.abs(n).toFixed(dp)}${unit}`
  return n > 0 ? `+${body}` : `${MINUS}${body}`
}

export function deltaTone(n: number): 'green' | 'red' | 'gray' {
  if (n > 0) return 'green'
  if (n < 0) return 'red'
  return 'gray'
}

// Small money amounts, e.g. estimated API spend: $x.xxx ($x.xxxx sub-cent).
export function fmtUsd(n: number): string {
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 4 : 3)}`
}

// Seconds -> m:ss clock.
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 'green' key kept for API stability — the positive tone renders light purple.
export const TONE: Record<string, string> = {
  green: '#A78BFA',
  red: '#F06A6A',
  gray: '#8A8A93',
  white: '#FFFFFF',
}
