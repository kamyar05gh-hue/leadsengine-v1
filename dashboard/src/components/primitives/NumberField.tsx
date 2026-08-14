import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * Shared appearance constants — the single source of truth for how a number
 * input looks, mirroring the Select primitive's contract. Callers never
 * restyle a NumberField: `className` is layout-only (width/margin), so the
 * control stays pixel-identical everywhere in the app.
 *
 * Fills and borders are inline styles because the scoped stylesheet resets
 * buttons to transparent/borderless with higher specificity than a single
 * Tailwind utility (see app-scope.css) — same reason Select does it.
 */
const FIELD_CLASS =
  'group relative inline-flex items-stretch overflow-hidden rounded-[10px] transition-colors duration-150'

const FIELD_STYLE: CSSProperties = {
  border: '1px solid #16161A',
  backgroundColor: '#0E0E11',
}

const INPUT_CLASS =
  'number-field-input min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[13px] tabular-nums text-white outline-none placeholder:text-[#5C5C66] disabled:cursor-not-allowed disabled:opacity-40'

const STEP_COLUMN_STYLE: CSSProperties = { borderLeft: '1px solid #16161A' }

const STEP_BUTTON_CLASS =
  'flex flex-1 cursor-pointer items-center justify-center px-2 text-[#6B6B76] transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-30'

/** Press-and-hold: delay before repeating, then the repeat interval. */
const HOLD_DELAY_MS = 380
const HOLD_INTERVAL_MS = 70

export interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  id?: string
  disabled?: boolean
  /** Layout only (width/margin) — never colors or borders. */
  className?: string
  'aria-label'?: string
}

/**
 * NumberField — the one numeric input for the whole dashboard.
 *
 * The browser's native spin buttons are suppressed (they render as tiny
 * grey OS-styled arrows that ignore the design system entirely) and
 * replaced with our own stacked chevron stepper:
 *
 * - accent-tinted hover, focus ring on the whole field, disabled at bounds
 * - press-and-hold repeats (380ms delay, then 70ms), pointer capture so a
 *   drag off the button still ends the repeat
 * - the input stays a real <input type="number">, so ArrowUp/ArrowDown,
 *   typing and form semantics all keep working natively
 * - every value is clamped to [min, max] and rounded to whole steps, on
 *   typing and on blur (a pasted "9999" can never reach the caller)
 */
export function NumberField({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  id,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  const holdRef = useRef<{ timeout?: number; interval?: number }>({})

  const clamp = useCallback(
    (n: number): number => {
      if (!Number.isFinite(n)) return min
      return Math.min(max, Math.max(min, Math.round(n)))
    },
    [min, max],
  )

  const stopHold = useCallback(() => {
    const h = holdRef.current
    if (h.timeout !== undefined) window.clearTimeout(h.timeout)
    if (h.interval !== undefined) window.clearInterval(h.interval)
    holdRef.current = {}
  }, [])

  // A hold left running past unmount would tick against a dead component.
  useEffect(() => stopHold, [stopHold])

  const bump = useCallback(
    (direction: 1 | -1) => {
      onChange(clamp(value + direction * step))
    },
    [clamp, onChange, step, value],
  )

  const startHold = useCallback(
    (direction: 1 | -1) => {
      bump(direction)
      stopHold()
      holdRef.current.timeout = window.setTimeout(() => {
        holdRef.current.interval = window.setInterval(() => bump(direction), HOLD_INTERVAL_MS)
      }, HOLD_DELAY_MS)
    },
    [bump, stopHold],
  )

  const atMin = value <= min
  const atMax = value >= max

  const stepButton = (direction: 1 | -1) => {
    const isUp = direction === 1
    const blocked = disabled || (isUp ? atMax : atMin)
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={blocked}
        className={STEP_BUTTON_CLASS}
        style={isUp ? undefined : { borderTop: '1px solid #16161A' }}
        onPointerDown={(e) => {
          if (blocked) return
          e.preventDefault() // keep focus on the input
          e.currentTarget.setPointerCapture(e.pointerId)
          startHold(direction)
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onPointerLeave={stopHold}
        onMouseEnter={(e) => {
          if (!blocked) e.currentTarget.style.color = 'var(--accent, #A78BFA)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = ''
        }}
      >
        {isUp ? <ChevronUp size={13} strokeWidth={2.5} /> : <ChevronDown size={13} strokeWidth={2.5} />}
      </button>
    )
  }

  return (
    <div
      className={`${FIELD_CLASS} ${className}`}
      style={FIELD_STYLE}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = '#33333C'
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = '#16161A'
      }}
    >
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        className={INPUT_CLASS}
        value={value}
        onChange={(e) => {
          // Allow a transiently empty field while typing without emitting NaN.
          if (e.target.value === '') return
          onChange(clamp(Number(e.target.value)))
        }}
        onBlur={(e) => {
          if (e.target.value === '') onChange(clamp(min))
        }}
      />
      <div className="flex w-[26px] flex-col" style={STEP_COLUMN_STYLE}>
        {stepButton(1)}
        {stepButton(-1)}
      </div>
    </div>
  )
}
