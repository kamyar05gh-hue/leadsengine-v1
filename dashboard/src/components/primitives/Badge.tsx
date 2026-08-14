import type { ReactNode } from 'react'

/**
 * Editorial tag — compact rectangle, 4px radius, no border, tinted background
 * (tone color at ~12% alpha), 10px uppercase letter-spaced semibold text in
 * the tone color.
 *
 * Variants:
 * - `tag` (default): plain tinted rect — taxonomy labels (persona, engine,
 *   format, language, class, kind …).
 * - `status`: adds a 2px accent bar on the left edge — run/health states
 *   (completed, running, failed, queued …).
 *
 * Core tones: success #A78BFA · running/info #5B8DEF · failed #F06A6A ·
 * neutral #8A8A93. Color is passed as a hex so any spec tone works.
 */
export function Badge({
  color,
  variant = 'tag',
  children,
}: {
  color: string
  variant?: 'tag' | 'status'
  children: ReactNode
}) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-[4px] px-2 py-[5px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em]"
      style={{
        backgroundColor: `${color}1F`,
        color,
        borderLeft: variant === 'status' ? `2px solid ${color}` : undefined,
      }}
    >
      {children}
    </span>
  )
}
