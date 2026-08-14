import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { EvidenceItem } from '@/lib/api'

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// EvidenceTable — per-prompt triples (prompt → answer → citations). Rows use
// the .row hover; body text is #8A8A93, prompts are emphasized in #C9C9D1.
export function EvidenceTable({ items }: { items: EvidenceItem[] }) {
  const [selected, setSelected] = useState<EvidenceItem | null>(null)

  if (items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[#5C5C66]">
        No evidence collected yet.
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        {/* Header */}
        <div className="grid grid-cols-[minmax(0,4fr)_110px_100px_minmax(0,3fr)_70px] gap-3 border-b border-[#131316] px-3 py-2.5">
          {['Prompt', 'Engine', 'Mentioned', 'Citations', ''].map((h, i) => (
            <div
              key={i}
              className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${i === 4 ? 'text-right' : ''}`}
            >
              {h}
            </div>
          ))}
        </div>
        {/* Rows */}
        {items.map((item) => (
          <div
            key={item.id}
            className="row grid grid-cols-[minmax(0,4fr)_110px_100px_minmax(0,3fr)_70px] items-center gap-3 border-b border-[#131316] px-3 py-2.5 last:border-0"
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] text-[#C9C9D1]" title={item.prompt}>
                {item.prompt}
              </div>
              {item.topic && <div className="mt-0.5 text-[11px] text-[#5C5C66]">{item.topic}</div>}
            </div>
            <div className="truncate text-[12px] text-[#8A8A93]">{item.engine}</div>
            <div
              className="text-[12px]"
              style={{ color: item.mentioned ? '#A78BFA' : '#5C5C66' }}
            >
              {item.mentioned ? 'Yes' : 'No'}
            </div>
            <div className="min-w-0">
              {item.citedUrls.length === 0 ? (
                <span className="text-[12px] text-[#3F3F47]">—</span>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {item.citedUrls.slice(0, 3).map((url, i) => (
                    <a
                      key={`${url}-${i}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 truncate text-[12px] text-[#8A8A93] transition-colors duration-150 hover:text-white"
                    >
                      {domainOf(url)}
                      <ExternalLink size={12} strokeWidth={1.5} />
                    </a>
                  ))}
                  {item.citedUrls.length > 3 && (
                    <span className="text-[12px] tabular-nums text-[#5C5C66]">
                      +{item.citedUrls.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="text-right">
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="text-[12px] text-[#8A8A93] transition-colors duration-150 hover:text-white"
              >
                View
              </button>
            </div>
          </div>
        ))}
      </div>

      <AnswerModal item={selected} onClose={() => setSelected(null)} />
    </>
  )
}

/**
 * AnswerModal — flat overlay, no blur (Law 2). Escape or backdrop click
 * closes. The answer body sits on the inset surface (#0E0E11).
 */
function AnswerModal({ item, onClose }: { item: EvidenceItem | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  if (!item) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.prompt}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-[15px] font-medium text-white">{item.prompt}</div>
          <div className="mt-1 text-[12px] text-[#5C5C66]">
            {item.engine}
            {item.topic ? ` · ${item.topic}` : ''}
          </div>
        </div>
        <div className="whitespace-pre-wrap rounded-[10px] border border-[#16161A] bg-[#0E0E11] p-4 text-[13px] leading-relaxed text-[#8A8A93]">
          {item.answer}
        </div>
        {item.citedUrls.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
              Cited sources
            </div>
            {item.citedUrls.map((url, i) => (
              <a
                key={`${url}-${i}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[12px] text-[#8A8A93] transition-colors duration-150 hover:text-white"
                title={url}
              >
                {url}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
