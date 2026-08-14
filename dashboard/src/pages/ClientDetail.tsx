import { Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import {
  getAiTraffic,
  getCitations,
  getClientPrompts,
  getCompanies,
  getCompany,
  getCompanyFiles,
  getFreshness,
  getGaps,
  getLandingPages,
  getMentions,
  getSupplyChain,
  getTracking,
  type CompanySummary,
} from '@/lib/api'
import { PageHeader } from '@/components/primitives/PageHeader'
import { DeleteCompanyDialog } from '@/components/DeleteCompanyDialog'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { VisibilityRing } from '@/components/VisibilityRing'

/** Percentages render to 2 decimals per the design system. */
function pct(value: number | undefined): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`
}

const TABS = [
  { segment: '', label: 'Generated Files', end: true },
  { segment: 'summary', label: 'AI Summary' },
  { segment: 'prompts', label: 'Prompts' },
  { segment: 'tracking', label: 'Tracking' },
  { segment: 'mentions', label: 'Mentions' },
  { segment: 'citations', label: 'Citations' },
  { segment: 'gaps', label: 'Content Gaps' },
  { segment: 'pages', label: 'Landing Pages' },
] as const

type PrefetchEntry = { queryKey: unknown[]; queryFn: () => Promise<unknown> }

/**
 * The queries each sub-tab needs, keyed by its route segment. Used twice:
 * all tabs are warmed the moment a client page opens, and each tab re-warms
 * on hover (queryClient.prefetchQuery is a no-op while the data is fresh).
 * The AI Summary tab is deliberately absent — its query can trigger an
 * expensive generation run on the backend, so it only fetches on open.
 */
const TAB_PREFETCHES: Record<string, (id: string) => PrefetchEntry[]> = {
  '': (id) => [{ queryKey: ['company-files', id], queryFn: () => getCompanyFiles(id) }],
  prompts: (id) => [{ queryKey: ['client-prompts', id], queryFn: () => getClientPrompts(id) }],
  tracking: (id) => [
    { queryKey: ['tracking', id], queryFn: () => getTracking(id) },
    { queryKey: ['ai-traffic', id], queryFn: () => getAiTraffic(id) },
    { queryKey: ['freshness', id], queryFn: () => getFreshness(id) },
  ],
  mentions: (id) => [{ queryKey: ['mentions', id], queryFn: () => getMentions(id) }],
  citations: (id) => [
    { queryKey: ['citations', id], queryFn: () => getCitations(id) },
    { queryKey: ['supply-chain', id], queryFn: () => getSupplyChain(id) },
  ],
  gaps: (id) => [
    { queryKey: ['gaps', id], queryFn: () => getGaps(id) },
    { queryKey: ['citations', id], queryFn: () => getCitations(id) },
    { queryKey: ['supply-chain', id], queryFn: () => getSupplyChain(id) },
  ],
  pages: (id) => [{ queryKey: ['landing-pages', id], queryFn: () => getLandingPages(id) }],
}

function prefetchTab(queryClient: QueryClient, id: string, segment: string): void {
  const entries = TAB_PREFETCHES[segment]?.(id) ?? []
  for (const { queryKey, queryFn } of entries) {
    // prefetchQuery never rejects — failures land in cache as error state,
    // which is exactly what the tab would have shown anyway.
    void queryClient.prefetchQuery({ queryKey, queryFn, staleTime: 60_000 })
  }
}

/**
 * Prefetch every sub-tab's dataset the moment a client page opens — tab
 * switches then render straight from the query cache (same feel as the main
 * dashboard) instead of each tab waiting on its own network round-trip.
 */
function usePrefetchClientData(id: string | undefined): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!id) return
    for (const segment of Object.keys(TAB_PREFETCHES)) prefetchTab(queryClient, id, segment)
  }, [id, queryClient])
}

/**
 * Client detail shell — PageHeader with the latest visibility score plus a
 * deep-linkable sub-navigation; each tab is a nested route rendered in the
 * Outlet below.
 */
export function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)

  const companyQuery = useQuery({
    queryKey: ['company', id],
    queryFn: () => getCompany(id!),
    enabled: Boolean(id),
  })

  // Companies list (usually cached) — supplies the live job id, which the
  // delete flow needs for the cancel-job-and-delete chain.
  const companiesQuery = useQuery<CompanySummary[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
  })
  const summaryRow = companiesQuery.data?.find((c) => c.id === id)
  // Live = whatever the backend's delete guard treats as live (running |
  // queued), plus 'pending' for older records.
  const liveStatuses: string[] = ['running', 'queued', 'pending']
  const liveJobId =
    summaryRow?.job && liveStatuses.includes(summaryRow.job.status) ? summaryRow.job.id : null

  // Kick off all sub-tab fetches in parallel right away.
  usePrefetchClientData(id)
  const queryClient = useQueryClient()
  const handleTabHover = useCallback(
    (segment: string) => {
      if (id) prefetchTab(queryClient, id, segment)
    },
    [id, queryClient],
  )

  if (companyQuery.isLoading) {
    // Genuinely first-ever load of this client — skeleton, not a spinner.
    // Revisits render instantly from cache.
    return (
      <div className="flex flex-col gap-5">
        <PanelSkeleton framed lines={3} className="h-[120px]" />
        <PanelSkeleton framed lines={5} className="h-[320px]" />
      </div>
    )
  }

  if (companyQuery.isError || !companyQuery.data) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <div className="text-[14px] text-[#F06A6A]">Client not found</div>
        <div className="text-[12px] text-[#5C5C66]">
          The company id "{id}" is unknown — or the backend is offline.
        </div>
      </div>
    )
  }

  const { company, latestScore } = companyQuery.data
  const overall = latestScore?.combined.overall
  const base = `/clients/${id}`

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        kicker="Client"
        title={company.name}
        titleAdornment={<VisibilityRing value={overall?.mentionRate} />}
        description={[company.sector, company.location].filter(Boolean).join(' · ')}
        stats={[
          { label: 'Mention rate', value: pct(overall?.mentionRate), sub: 'latest audit' },
          { label: 'Citation rate', value: pct(overall?.citationRate), sub: 'own domain cited' },
          { label: 'Share of voice', value: pct(overall?.sov), sub: 'among tracked brands' },
        ]}
      />

      {/* Sub-navigation — design-system tabs, delete affordance on the right */}
      <div className="flex items-center justify-between gap-4">
        <div className="tabs min-w-0 overflow-x-auto" role="tablist" aria-label="Client sections">
          {TABS.map((tab) => {
            const to = tab.segment === '' ? base : `${base}/${tab.segment}`
            const active =
              tab.segment === '' ? location.pathname === base : location.pathname.startsWith(to)
            return (
              <button
                key={tab.segment || 'index'}
                type="button"
                role="tab"
                aria-selected={active}
                data-active={active}
                className="tab whitespace-nowrap"
                onClick={() => navigate(to)}
                onMouseEnter={() => handleTabHover(tab.segment)}
                onFocus={() => handleTabHover(tab.segment)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          aria-label={`Delete ${company.name}`}
          title={`Delete ${company.name}`}
          onClick={() => setDeleting(true)}
          className="group flex shrink-0 items-center gap-1.5 pb-3"
        >
          <span className="flex items-center gap-1.5 text-[12px] text-[#5C5C66] transition-colors duration-150 group-hover:text-[#F06A6A]">
            <Trash2 size={14} strokeWidth={1.5} />
            Delete
          </span>
        </button>
      </div>

      {/* Tab panels render from cache instantly; the only motion between
          tabs is this subtle 150ms crossfade — never a spinner. */}
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <Outlet />
      </motion.div>

      {deleting && (
        <DeleteCompanyDialog
          companyId={company.id}
          companyName={company.name}
          jobId={liveJobId}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate('/clients')}
        />
      )}
    </div>
  )
}
