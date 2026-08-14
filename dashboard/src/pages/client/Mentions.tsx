import { useMemo } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Link2 } from 'lucide-react'
import { getCompany, getMentions, type Mention, type MentionSentiment } from '@/lib/api'
import { Card } from '@/components/primitives/Card'
import { StatBox } from '@/components/primitives/StatBox'
import { Badge } from '@/components/primitives/Badge'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'

const MAX_CARDS = 50

const SENTIMENT_COLOR: Record<Exclude<MentionSentiment, null>, string> = {
  positive: '#A78BFA',
  neutral: '#5C5C66',
  negative: '#F06A6A',
}

const ENGINE_COLOR = '#5B8DEF'

function relTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return formatDistanceToNow(d, { addSuffix: true })
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Excerpt with every brand-name occurrence wrapped in a purple mark. */
function HighlightedExcerpt({ text, brand }: { text: string; brand: string | undefined }) {
  const parts = useMemo(() => {
    if (!brand || !text) return null
    const re = new RegExp(`(${escapeRegExp(brand)})`, 'gi')
    const split = text.split(re)
    return split.length > 1 ? split : null
  }, [text, brand])

  if (!parts) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        brand && part.toLowerCase() === brand.toLowerCase() ? (
          <mark key={i} className="brand-mark">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

/** One mention: engine chip + sentiment dot header, prompt caption, excerpt, URL chips. */
function MentionCard({
  mention,
  brand,
  index,
}: {
  mention: Mention
  brand: string | undefined
  index: number
}) {
  const excerpt = mention.mentionContext || mention.excerpt || ''
  return (
    <article
      className="stagger-item rounded-[12px] border border-[#16161A] bg-[#0E0E11] p-4"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge color={ENGINE_COLOR}>{mention.engine}</Badge>
        {mention.sentiment ? (
          <span className="flex items-center gap-1.5 text-[11px] capitalize text-[#8A8A93]">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: SENTIMENT_COLOR[mention.sentiment] }}
            />
            {mention.sentiment}
          </span>
        ) : (
          <span className="text-[11px] text-[#3F3F47]">not judged</span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-[#5C5C66]" title={mention.createdAt}>
          {relTime(mention.createdAt)}
        </span>
      </div>

      {/* Prompt caption */}
      <div className="mt-2.5 text-[12px] text-[#5C5C66]" title={mention.prompt}>
        <span className="text-[#6B6B76]">Prompt · </span>
        {mention.prompt}
        {(mention.scope || mention.persona) && (
          <span className="text-[#3F3F47]">
            {' '}
            — {[mention.scope, mention.persona].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {/* Excerpt with brand highlight */}
      {excerpt && (
        <p className="mt-2 text-[13px] leading-relaxed text-[#C9C9D1]">
          <HighlightedExcerpt text={excerpt} brand={brand} />
        </p>
      )}

      {/* Cited-URL chips */}
      {mention.citedUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mention.citedUrls.slice(0, 6).map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              title={url}
              className="inline-flex max-w-[220px] items-center gap-1.5 rounded-[4px] bg-[#8A8A931F] px-2 py-1 text-[11px] text-[#8A8A93] transition-colors duration-150 hover:text-white"
            >
              <Link2 size={11} strokeWidth={1.5} className="shrink-0 text-[#5C5C66]" />
              <span className="truncate">{domainOf(url)}</span>
            </a>
          ))}
          {mention.citedUrls.length > 6 && (
            <span className="px-1 py-1 text-[11px] text-[#5C5C66]">
              +{mention.citedUrls.length - 6} more
            </span>
          )}
        </div>
      )}
    </article>
  )
}

/** Mentions — every AI answer that named the brand, as a card feed. */
export function Mentions() {
  const { id } = useParams<{ id: string }>()

  const mentionsQuery = useQuery({
    queryKey: ['mentions', id],
    queryFn: () => getMentions(id!),
    enabled: Boolean(id),
  })
  // Brand name for excerpt highlighting — usually cached by the shell.
  const companyQuery = useQuery({
    queryKey: ['company', id],
    queryFn: () => getCompany(id!),
    enabled: Boolean(id),
  })
  const brand = companyQuery.data?.company.name

  if (mentionsQuery.isLoading) {
    // First-ever load only — cached revisits render instantly.
    return <PanelSkeleton framed lines={5} className="h-64" />
  }

  if (mentionsQuery.isError || !mentionsQuery.data) {
    return <EmptyState>Could not load mentions. Is the backend running?</EmptyState>
  }

  const { total, mentionRate, mentions } = mentionsQuery.data
  const judged = mentions.filter((m) => m.sentiment !== null)
  const positiveShare =
    judged.length > 0
      ? judged.filter((m) => m.sentiment === 'positive').length / judged.length
      : undefined

  const visible = mentions.slice(0, MAX_CARDS)
  const hidden = mentions.length - visible.length

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatBox label="Total mentions" value={String(total)} />
        <StatBox label="Mention rate" value={`${(mentionRate * 100).toFixed(2)}%`} />
        <StatBox
          label="Positive share"
          value={positiveShare === undefined ? '—' : `${(positiveShare * 100).toFixed(2)}%`}
          delta={judged.length > 0 ? `${judged.length} judged` : undefined}
          tone={positiveShare === undefined ? 'gray' : 'green'}
        />
      </div>

      <Card title="Mentions" meta={mentions.length > 0 ? `${mentions.length} answers · newest first` : undefined}>
        {mentions.length === 0 ? (
          <EmptyState>No mentions recorded yet. Run an audit to collect answers.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((m, i) => (
              <MentionCard key={`${m.engine}-${m.createdAt}-${i}`} mention={m} brand={brand} index={i} />
            ))}
            {hidden > 0 && (
              <div className="pt-1 text-center text-[12px] text-[#5C5C66]">
                +{hidden} more mentions
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
