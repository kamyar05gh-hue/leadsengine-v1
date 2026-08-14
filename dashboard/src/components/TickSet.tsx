import { Check } from 'lucide-react'

export interface TickSetOption {
  value: string
  label: string
}

interface TickSetBaseProps {
  options: TickSetOption[]
  /** Optional aria-label for the group. */
  ariaLabel?: string
}

type TickSetProps =
  | (TickSetBaseProps & {
      mode: 'multi'
      selected: string[]
      onChange: (selected: string[]) => void
    })
  | (TickSetBaseProps & {
      mode: 'single'
      selected: string
      onChange: (selected: string) => void
    })

/**
 * Row of selectable pill ticks. Unselected: inset surface, muted text.
 * Selected: accent border + text with a Check icon. Hover only changes
 * border/text color — never the background (Law 1).
 */
export function TickSet(props: TickSetProps) {
  const { options, mode, ariaLabel } = props

  const isSelected = (value: string) =>
    mode === 'multi' ? props.selected.includes(value) : props.selected === value

  const toggle = (value: string) => {
    if (mode === 'multi') {
      const next = props.selected.includes(value)
        ? props.selected.filter((v) => v !== value)
        : [...props.selected, value]
      props.onChange(next)
    } else {
      props.onChange(value)
    }
  }

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = isSelected(option.value)
        return (
          <div
            key={option.value}
            role={mode === 'multi' ? 'checkbox' : 'radio'}
            aria-checked={selected}
            tabIndex={0}
            onClick={() => toggle(option.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggle(option.value)
              }
            }}
            className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-[8px] border bg-[#0E0E11] px-3 py-1.5 text-[12px] outline-none transition-[color,border-color] ease ${
              selected
                ? ''
                : 'border-[#1C1C21] text-[#8A8A93] hover:border-[#33333C] hover:text-white'
            }`}
            style={
              selected
                ? {
                    borderColor: 'var(--accent, #A78BFA)',
                    color: 'var(--accent, #A78BFA)',
                    transitionDuration: '140ms',
                  }
                : { transitionDuration: '140ms' }
            }
          >
            {selected && <Check size={12} strokeWidth={2} />}
            {option.label}
          </div>
        )
      })}
    </div>
  )
}
