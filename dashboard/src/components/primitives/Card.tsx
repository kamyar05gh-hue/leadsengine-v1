import type { ReactNode } from 'react'

// Card — the workhorse container. Title + meta on the same baseline,
// `right` holds tabs or filters, content sits mt-5 below.
export function Card({
  title,
  meta,
  right,
  children,
  className = '',
}: {
  title: string
  meta?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`card-lift rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] p-6 ${className}`}>
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <div className="text-[20px] font-medium text-white">{title}</div>
          {meta && <div className="truncate text-[12px] text-[#5C5C66]">{meta}</div>}
        </div>
        {right}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  )
}
