import type { ReactNode } from 'react'
import { Sparkles, type LucideIcon } from 'lucide-react'

/**
 * EmptyState — spec geometry, with a small glyph medallion and an optional
 * one-line action (link/button) under the message so an empty panel always
 * tells the user what to do next.
 */
export function EmptyState({
  icon: Icon = Sparkles,
  action,
  children,
}: {
  icon?: LucideIcon
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-3 rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] px-8 text-center">
      <span
        aria-hidden
        className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-[#33333C]"
        style={{ backgroundColor: 'rgba(167, 139, 250, .08)' }}
      >
        <Icon size={16} strokeWidth={1.5} className="text-[#A78BFA]" />
      </span>
      <div className="max-w-[440px] text-[13px] leading-relaxed text-[#5C5C66]">{children}</div>
      {action && <div className="text-[12px]">{action}</div>}
    </div>
  )
}
