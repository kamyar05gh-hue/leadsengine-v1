import { useEffect, useMemo, useRef, useState } from 'react'
import { MINUS } from '@/lib/format'

/** First numeric token in a formatted KPI string ("$1,234.50", "12.34%", "−6.1%"). */
const NUM_RE = /[-−]?\d[\d,]*(?:\.\d+)?/

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

interface ParsedValue {
  prefix: string
  suffix: string
  /** Signed numeric target. */
  target: number
  decimals: number
  grouped: boolean
}

function parseValue(text: string): ParsedValue | null {
  const m = NUM_RE.exec(text)
  if (!m) return null
  const raw = m[0]
  const negative = raw.startsWith('-') || raw.startsWith(MINUS)
  const digits = raw.replace(/^[-−]/, '').replace(/,/g, '')
  const abs = Number(digits)
  if (!Number.isFinite(abs)) return null
  const dot = digits.indexOf('.')
  return {
    prefix: text.slice(0, m.index),
    suffix: text.slice(m.index + raw.length),
    target: negative ? -abs : abs,
    decimals: dot === -1 ? 0 : digits.length - dot - 1,
    grouped: raw.includes(','),
  }
}

function formatNumber(v: number, p: ParsedValue): string {
  const sign = v < 0 ? MINUS : ''
  const abs = Math.abs(v)
  const body = p.grouped
    ? abs.toLocaleString('en-US', {
        minimumFractionDigits: p.decimals,
        maximumFractionDigits: p.decimals,
      })
    : abs.toFixed(p.decimals)
  return `${sign}${body}`
}

/**
 * KPI count-up. Renders a formatted value string, animating its numeric part
 * from 0 (first paint) — or from the previously shown number (data refresh) —
 * to the target over ~700ms with an ease-out cubic. Prefix/suffix/decimals/
 * grouping of the original string are preserved, so "$1,234.50" and "12.34%"
 * both animate faithfully. Respects prefers-reduced-motion (renders final
 * value immediately). Non-numeric values ("—") render as-is.
 */
export function AnimatedValue({ value, duration = 700 }: { value: string; duration?: number }) {
  const parsed = useMemo(() => parseValue(value), [value])
  const target = parsed?.target ?? null
  // Where the next animation starts from — last settled/painted number.
  const fromRef = useRef(0)
  const [current, setCurrent] = useState<number | null>(null)

  useEffect(() => {
    if (target === null) return
    if (prefersReducedMotion()) {
      fromRef.current = target
      setCurrent(target)
      return
    }
    const from = fromRef.current
    if (from === target) {
      setCurrent(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = from + (target - from) * eased
      fromRef.current = v
      setCurrent(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  if (!parsed || target === null) return <>{value}</>
  const shown = current ?? (prefersReducedMotion() ? target : 0)
  return (
    <>
      {parsed.prefix}
      {formatNumber(shown, parsed)}
      {parsed.suffix}
    </>
  )
}
