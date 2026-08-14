import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { ApiError, getAiSummary, type AiSummary } from '@/lib/api'
import { Card } from '@/components/primitives/Card'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PrimaryButton } from '@/components/primitives/Button'

// ---------- Minimal markdown -> JSX (headers, bold, bullets, numbers) ----------

/** Inline pass: **bold** segments become white <strong>. */
function renderInline(text: string): ReactNode[] {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-medium text-white">
          {part}
        </strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )
}

// (tiny local Fragment alias keeps the map above keyable without importing React)
function Fragment({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function Bullets({ items, ordered }: { items: string[]; ordered: boolean }) {
  return (
    <ul className="my-2 flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[#8A8A93]">
          <span
            className="shrink-0 tabular-nums text-[#E8A04C]"
            style={ordered ? undefined : { color: '#5B8DEF' }}
          >
            {ordered ? `${i + 1}.` : '·'}
          </span>
          <span className="min-w-0">{renderInline(item)}</span>
        </li>
      ))}
    </ul>
  )
}

export function MarkdownLite({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let ordered = false
  const flush = () => {
    if (list.length > 0) {
      blocks.push(<Bullets key={`l-${blocks.length}`} items={list} ordered={ordered} />)
      list = []
    }
  }

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') {
      flush()
      continue
    }
    const header = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (header) {
      flush()
      const level = header[1].length
      blocks.push(
        <div
          key={`h-${blocks.length}`}
          className={
            level <= 2
              ? 'mt-5 text-[16px] font-medium text-white first:mt-0'
              : 'mt-4 text-[13px] font-medium text-[#C9C9D1] first:mt-0'
          }
        >
          {renderInline(header[2])}
        </div>,
      )
    } else if (bullet) {
      if (list.length > 0 && ordered) flush()
      ordered = false
      list.push(bullet[1])
    } else if (numbered) {
      if (list.length > 0 && !ordered) flush()
      ordered = true
      list.push(numbered[1])
    } else {
      flush()
      blocks.push(
        <p
          key={`p-${blocks.length}`}
          className="my-2 text-[13px] leading-relaxed text-[#8A8A93] first:mt-0"
        >
          {renderInline(line)}
        </p>,
      )
    }
  }
  flush()
  return <div>{blocks}</div>
}

// ---------- Loading state ----------

const THINKING_LINES = [
  'Loading the executive brief…',
  'Weighing mention and citation rates…',
  'Sizing up the competitors in your answers…',
  'Tracing which domains the engines trust…',
  'Drafting the verdict…',
]

function SummarySkeleton() {
  const [lineIdx, setLineIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setLineIdx((i) => (i + 1) % THINKING_LINES.length), 2600)
    return () => clearInterval(id)
  }, [])
  return (
    <div aria-busy="true">
      <div className="flex items-center gap-2.5">
        <Sparkles size={16} strokeWidth={1.5} className="pulse-dot shrink-0 text-[#A78BFA]" />
        <span className="text-[13px] text-[#8A8A93]">{THINKING_LINES[lineIdx]}</span>
      </div>
      <p className="mt-1.5 text-[11px] text-[#5C5C66]">
        The brief is prepared during each audit — a first-time generation takes 10–30 seconds.
      </p>
      <div className="mt-5 flex flex-col gap-2.5">
        <div className="shimmer h-4 w-3/4" />
        <div className="shimmer h-3 w-full" />
        <div className="shimmer h-3 w-11/12" />
        <div className="shimmer h-3 w-2/3" />
        <div className="shimmer mt-3 h-4 w-1/3" />
        <div className="shimmer h-3 w-10/12" />
        <div className="shimmer h-3 w-3/4" />
      </div>
    </div>
  )
}

// ---------- Main view ----------

/**
 * AI executive summary for one company. The backend pre-generates and
 * persists the brief at audit completion, so this is a plain read: fetch on
 * mount, markdown render. 404 → "run an audit first"; 502 → retry affordance.
 * The shimmer only shows in the rare first-generation case.
 */
export function AiSummaryView({ companyId }: { companyId: string }) {
  const query = useQuery<AiSummary, Error>({
    queryKey: ['ai-summary', companyId],
    queryFn: () => getAiSummary(companyId),
    enabled: companyId !== '',
    retry: false,
    staleTime: Infinity,
  })

  // isLoading only: a manual Retry must not blank out an already-rendered
  // brief (isFetching is true for every background refetch too).
  if (query.isLoading) {
    return (
      <Card title="AI Summary" meta="executive brief">
        <SummarySkeleton />
      </Card>
    )
  }

  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : 0
    if (status === 404) {
      return (
        <EmptyState>
          No audit results yet for this client — run an audit first, then the AI summary is
          generated from its findings.
        </EmptyState>
      )
    }
    return (
      <Card title="AI Summary" meta="executive brief">
        <div className="flex flex-col items-start gap-3">
          <div>
            <div className="text-[14px] text-[#F06A6A]">
              {status === 502 ? 'Summary generation failed' : 'Could not load the summary'}
            </div>
            <p className="mt-1 max-w-[560px] break-words text-[12px] leading-relaxed text-[#5C5C66]">
              {query.error.message}
            </p>
          </div>
          <PrimaryButton onClick={() => query.refetch()}>Retry</PrimaryButton>
        </div>
      </Card>
    )
  }

  const data = query.data
  if (!data) return null

  return (
    <Card title="AI Summary" meta="executive brief">
      <MarkdownLite source={data.summary} />
      <div className="mt-5 border-t border-[#131316] pt-3 text-[11px] tabular-nums text-[#5C5C66]">
        Stand: {new Date(data.generatedAt).toLocaleString('en-GB', { hour12: false })}
      </div>
    </Card>
  )
}
