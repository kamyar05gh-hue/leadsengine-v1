import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

/**
 * Shared appearance constants — the single source of truth for how a
 * dropdown looks. Callers never restyle a Select: the `className` prop is
 * documented as layout-only (width/margin), so trigger, panel and option
 * rows stay pixel-identical everywhere in the app.
 *
 * Fills and borders are inline styles because the scoped stylesheet resets
 * every button to transparent/borderless with higher specificity than a
 * single Tailwind utility (see app-scope.css).
 */
const SELECT_TRIGGER_CLASS =
  'inline-flex items-center justify-between gap-2.5 rounded-[10px] px-3 py-2 text-[13px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40'

const SELECT_TRIGGER_STYLE: CSSProperties = {
  border: '1px solid #16161A',
  backgroundColor: '#0E0E11',
  color: '#C9C9D1',
}

const SELECT_PANEL_CLASS =
  'select-panel fixed z-[80] max-h-[280px] overflow-y-auto rounded-[10px] p-1.5'

const SELECT_PANEL_STYLE: CSSProperties = {
  backgroundColor: '#101014',
  border: '1px solid #1C1C21',
  boxShadow: '0 18px 40px rgba(0,0,0,.55)',
}

const SELECT_OPTION_CLASS =
  'flex cursor-pointer items-center justify-between gap-3 rounded-[8px] px-2.5 py-[7px] text-[13px] transition-colors duration-100'

/**
 * Select — the one dropdown primitive for the whole dashboard, replacing
 * every native <select>. Button trigger + floating listbox panel rendered
 * in a portal:
 *
 * - dark panel (#101014), hairline border, max-height scroll
 * - hover/active rows with a purple tint, selected row shows a check
 * - keyboard: ArrowUp/Down, Home/End, Enter/Space select, Esc closes,
 *   printable keys type-ahead to the first matching option
 * - full ARIA listbox pattern (combobox trigger + option rows)
 * - subtle scale-fade on open/close (disabled under prefers-reduced-motion
 *   via the .select-panel rules in app-scope.css)
 *
 * Value/onChange contract matches a native select: plain string values.
 *
 * `className` is LAYOUT-ONLY (width, margin). Appearance comes from the
 * SELECT_* constants above so every dropdown in the app is identical.
 */
export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = 'Select…',
  className = '',
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  ariaLabel?: string
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ query: '', at: 0 })
  const listboxId = useId()

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value])
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const close = useCallback(() => {
    setClosing(true)
    // Let the close animation play before unmounting the portal.
    window.setTimeout(() => {
      setClosing(false)
      setOpen(false)
    }, 120)
  }, [])

  const openPanel = useCallback(() => {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }, [disabled, selectedIndex])

  const commit = useCallback(
    (index: number) => {
      const opt = options[index]
      if (opt) onChange(opt.value)
      close()
      triggerRef.current?.focus()
    },
    [options, onChange, close],
  )

  // Position the panel under the trigger (flips above when out of space).
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const panelH = Math.min(280, options.length * 34 + 12)
      const below = window.innerHeight - r.bottom
      const top = below < panelH + 8 && r.top > panelH + 8 ? r.top - panelH - 6 : r.bottom + 6
      setPanelPos({
        top,
        left: Math.min(r.left, Math.max(8, window.innerWidth - Math.max(r.width, 180) - 8)),
        width: Math.max(r.width, 180),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, options.length])

  // Dismiss on any outside pointerdown.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  // Keep the active row in view while navigating.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const typeaheadJump = (key: string) => {
    const now = Date.now()
    const state = typeahead.current
    state.query = (now - state.at < 600 ? state.query : '') + key.toLowerCase()
    state.at = now
    const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(state.query))
    if (idx >= 0) {
      setActiveIndex(idx)
      if (!open) onChange(options[idx].value)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openPanel()
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        typeaheadJump(e.key)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(options.length - 1, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (activeIndex >= 0) commit(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        close()
        triggerRef.current?.focus()
        break
      case 'Tab':
        close()
        break
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) typeaheadJump(e.key)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onKeyDown}
        className={`${SELECT_TRIGGER_CLASS} ${className}`}
        style={SELECT_TRIGGER_STYLE}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`shrink-0 text-[#5C5C66] transition-transform duration-150 ${open && !closing ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            data-closing={closing || undefined}
            className={SELECT_PANEL_CLASS}
            style={{
              ...SELECT_PANEL_STYLE,
              top: panelPos.top,
              left: panelPos.left,
              minWidth: panelPos.width,
            }}
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value
              const isActive = i === activeIndex
              return (
                <div
                  key={opt.value}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onPointerMove={() => setActiveIndex(i)}
                  onClick={() => commit(i)}
                  className={SELECT_OPTION_CLASS}
                  style={{
                    backgroundColor: isActive ? 'rgba(167, 139, 250, .10)' : 'transparent',
                    color: isSelected ? '#FFFFFF' : isActive ? '#FFFFFF' : '#C9C9D1',
                  }}
                >
                  <span className="min-w-0 truncate">{opt.label}</span>
                  {isSelected && (
                    <Check size={13} strokeWidth={2} className="shrink-0 text-[#A78BFA]" />
                  )}
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
