import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BookOpen,
  FileText,
  ListOrdered,
  Loader2,
  MessageCircleQuestion,
  PenLine,
  Scale,
  Table as TableIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  API_BASE,
  createLandingPage,
  getCitations,
  getGaps,
  getLandingPages,
  getSupplyChain,
  mergeSupplyChain,
  type CitationDomain,
  type ContentGap,
} from '@/lib/api'
import { Badge } from '@/components/primitives/Badge'
import { StatBox } from '@/components/primitives/StatBox'
import { OutlineButton } from '@/components/primitives/Button'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { Select } from '@/components/primitives/Select'
import { DomainFavicon } from '@/components/CompetitorTeardown'

/**
 * Visual identity for each recommended content format — the icon makes the
 * format scannable without reading the label.
 */
const FORMAT_META: Record<string, { icon: LucideIcon; tint: string }> = {
  faq: { icon: MessageCircleQuestion, tint: '#5B8DEF' },
  table: { icon: TableIcon, tint: '#E8A04C' },
  comparison: { icon: Scale, tint: '#A78BFA' },
  listicle: { icon: ListOrdered, tint: '#D5518A' },
  guide: { icon: BookOpen, tint: '#7C9BD4' },
}

function formatMeta(format: string): { icon: LucideIcon; tint: string } {
  return FORMAT_META[format.toLowerCase()] ?? { icon: FileText, tint: '#8A8A93' }
}

function isOpen(g: ContentGap): boolean {
  return g.status !== 'done' && g.status !== 'dismissed' && g.status !== 'in_progress'
}

/**
 * Infer the prompt type of a gap so we can match it against the prompt types
 * a citation domain was seen in. Mirrors the pipeline's prompt categories.
 */
function inferPromptType(prompt: string): string | null {
  const p = prompt.toLowerCase()
  if (p.includes(' vs ') || p.includes(' versus ') || p.includes('vergleich')) return 'comparison'
  if (p.startsWith('best') || p.startsWith('beste') || p.includes('top ')) return 'best-of'
  if (p.includes('review') || p.includes('erfahrung') || p.includes('bewertung')) return 'reputation'
  return null
}

/**
 * Pick the domains where competitors currently win *for this kind of prompt*:
 * opportunity domains (competitor citations, zero of ours) whose prompt types
 * match the gap. Falls back to the top opportunity domains overall.
 */
function winningDomainsFor(gap: ContentGap, opportunities: CitationDomain[]): CitationDomain[] {
  const type = inferPromptType(gap.prompt)
  const ranked = [...opportunities].sort((a, b) => b.competitorCitations - a.competitorCitations)
  if (type) {
    const matched = ranked.filter((d) => (d.promptTypes ?? []).includes(type))
    if (matched.length > 0) return matched.slice(0, 2)
  }
  return ranked.slice(0, 2)
}

export function ContentGaps() {
  // Scoped to the client route — the client detail shell owns the header.
  const { id: companyId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [formatFilter, setFormatFilter] = useState('all')
  const [creatingId, setCreatingId] = useState<string | null>(null)
  /**
   * Gaps generated in this session. The backend never flips
   * content_gaps.status, so without this the card would keep offering
   * "Generate page" for a gap that already produced one.
   */
  const [createdIds, setCreatedIds] = useState<Set<string>>(() => new Set())

  const gapsQuery = useQuery({
    queryKey: ['gaps', companyId],
    queryFn: () => getGaps(companyId!),
    enabled: Boolean(companyId),
  })
  const gaps = useMemo(() => gapsQuery.data ?? [], [gapsQuery.data])

  // Opportunity domains power the "competitors win here" previews per gap.
  // Merged with the supply chain so competitor co-occurrence counts as
  // competitor citations even before the citation monitor classifies them.
  const citationsQuery = useQuery({
    queryKey: ['citations', companyId],
    queryFn: () => getCitations(companyId!),
    enabled: Boolean(companyId),
  })
  const supplyChainQuery = useQuery({
    queryKey: ['supply-chain', companyId],
    queryFn: () => getSupplyChain(companyId!),
    enabled: Boolean(companyId),
  })
  const opportunities = useMemo(
    () =>
      mergeSupplyChain(citationsQuery.data ?? [], supplyChainQuery.data ?? null).filter(
        (d) => d.companyCitations === 0 && d.competitorCitations > 0,
      ),
    [citationsQuery.data, supplyChainQuery.data],
  )

  // Already-generated pages for this client — the real "pages generated" count.
  const landingPagesQuery = useQuery({
    queryKey: ['landing-pages', companyId],
    queryFn: () => getLandingPages(companyId!),
    enabled: Boolean(companyId),
  })

  const createMutation = useMutation({
    mutationFn: (gapId: string) => createLandingPage(companyId!, gapId),
    onMutate: (gapId) => setCreatingId(gapId),
    onSettled: () => setCreatingId(null),
    onSuccess: (page, gapId) => {
      setCreatedIds((prev) => new Set(prev).add(gapId))
      queryClient.invalidateQueries({ queryKey: ['landing-pages', companyId] })
      queryClient.invalidateQueries({ queryKey: ['gaps', companyId] })
      queryClient.invalidateQueries({ queryKey: ['company-files', companyId] })
      toast.success(`Landing page created: ${page.title}`, {
        action: page.htmlUrl
          ? {
              label: 'Open',
              onClick: () =>
                window.open(`${API_BASE.replace(/\/api$/, '')}${page.htmlUrl}`, '_blank'),
            }
          : undefined,
      })
    },
    onError: () => toast.error('Failed to create content. Is the backend running?'),
  })

  const formats = useMemo(
    () => Array.from(new Set(gaps.map((g) => g.recommendedFormat.toLowerCase()))).sort(),
    [gaps],
  )

  const filtered = useMemo(
    () =>
      formatFilter === 'all'
        ? gaps
        : gaps.filter((g) => g.recommendedFormat.toLowerCase() === formatFilter),
    [gaps, formatFilter],
  )

  // Cards grouped by recommended format, groups ordered by size.
  const groups = useMemo(() => {
    const byFormat = new Map<string, ContentGap[]>()
    for (const g of filtered) {
      const key = g.recommendedFormat.toLowerCase()
      const list = byFormat.get(key) ?? []
      list.push(g)
      byFormat.set(key, list)
    }
    return [...byFormat.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  const openCount = gaps.filter(isOpen).length
  // Truthful count: what the landing-pages endpoint actually holds. (Gap
  // status is never advanced server-side, so it cannot be the source here.)
  const generatedCount = landingPagesQuery.data?.length ?? 0

  if (gapsQuery.isLoading) {
    return <PanelSkeleton framed lines={5} className="h-64" />
  }

  // Empty state ONLY when the API truly returned no gaps.
  if (gaps.length === 0) {
    return (
      <EmptyState>
        No content gaps detected yet. Gaps are populated after every audit — run one to find the
        prompts where AI engines cannot cite you.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Summary header */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatBox
          label="Open gaps"
          value={String(openCount)}
          delta={`${gaps.length} total`}
          tone={openCount > 0 ? 'green' : 'gray'}
        />
        <StatBox label="Pages generated" value={String(generatedCount)} />
        <StatBox label="Formats" value={String(formats.length)} />
        <div className="flex items-end justify-start rounded-[12px] border border-[#1C1C21] bg-[#0B0B0D] px-5 py-4">
          <div className="flex w-full flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
              Filter by format
            </span>
            <Select
              ariaLabel="Filter gaps by format"
              value={formatFilter}
              onChange={setFormatFilter}
              options={[
                { value: 'all', label: 'All formats' },
                ...formats.map((f) => ({ value: f, label: f })),
              ]}
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-[160px] items-center justify-center rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] text-[13px] text-[#5C5C66]">
          No gaps recommend this format.
        </div>
      ) : (
        groups.map(([format, groupGaps]) => {
          const { icon: Icon, tint } = formatMeta(format)
          return (
            <section key={format} aria-label={`${format} gaps`}>
              {/* Format group header */}
              <div className="mb-3 flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-[8px]"
                  style={{ backgroundColor: `${tint}1A`, border: `1px solid ${tint}40` }}
                >
                  <Icon size={14} strokeWidth={1.5} style={{ color: tint }} />
                </span>
                <span className="text-[13px] font-medium capitalize text-white">{format}</span>
                <span className="text-[12px] tabular-nums text-[#5C5C66]">
                  {groupGaps.length} {groupGaps.length === 1 ? 'gap' : 'gaps'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {groupGaps.map((gap, gapIndex) => {
                  const winning = winningDomainsFor(gap, opportunities)
                  const creating = creatingId === gap.id
                  const done =
                    gap.status === 'done' || gap.status === 'in_progress' || createdIds.has(gap.id)
                  return (
                    <div
                      key={gap.id}
                      className="card-lift stagger-item flex flex-col rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] p-5"
                      style={{ animationDelay: `${Math.min(gapIndex, 12) * 45}ms` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 text-[13px] font-medium leading-snug text-[#C9C9D1]">
                          {gap.prompt}
                        </div>
                        <Badge color={tint}>
                          <Icon size={12} strokeWidth={1.5} className="mr-1" />
                          {gap.recommendedFormat}
                        </Badge>
                      </div>
                      {/* Reason as caption */}
                      <div className="mt-2 text-[12px] leading-relaxed text-[#8A8A93]" title={gap.reason}>
                        {gap.reason}
                      </div>

                      {/* Where competitors currently win for this kind of prompt */}
                      {winning.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5">
                          {winning.map((d) => (
                            <span
                              key={d.domain}
                              className="flex items-center gap-2 text-[12px] text-[#5C5C66]"
                            >
                              <DomainFavicon domain={d.domain} />
                              <span className="truncate" title={d.domain}>
                                {d.domain}
                              </span>
                              <span className="tabular-nums">
                                ({d.competitorCitations} competitor cites)
                              </span>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                        <span className="text-[11px] text-[#5C5C66]">
                          {gap.topic ?? ''}
                        </span>
                        {done ? (
                          <Badge color="#A78BFA">Created</Badge>
                        ) : (
                          <OutlineButton
                            disabled={creating}
                            onClick={() => createMutation.mutate(gap.id)}
                            className="inline-flex items-center gap-1.5"
                          >
                            {creating ? (
                              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                            ) : (
                              <PenLine size={14} strokeWidth={1.5} />
                            )}
                            {creating ? 'Generating…' : 'Generate page'}
                          </OutlineButton>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
