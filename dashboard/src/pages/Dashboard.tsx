import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  API_HOST,
  getAudits,
  getCompanies,
  getCostsSummary,
  getGaps,
  type Audit,
  type CompanySummary,
} from '@/lib/api'
import { fmtInt } from '@/lib/format'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Card } from '@/components/primitives/Card'
import { Badge } from '@/components/primitives/Badge'
import { SummaryTile } from '@/components/primitives/SummaryTile'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { PipelineStepper } from '@/components/PipelineStepper'
import { useMonitoredCompanies } from '@/hooks/useMonitoring'

const STATUS_COLOR: Record<Audit['status'], string> = {
  completed: '#A78BFA',
  running: '#5B8DEF',
  queued: '#8A8A93',
  pending: '#8A8A93',
  failed: '#F06A6A',
}

/** Percentages render to 2 decimals per the design system. */
function pct(value: number | undefined | null): string {
  return value === undefined || value === null ? '—' : `${(value * 100).toFixed(2)}%`
}

/** Buyer persona, hard-capped at ~40 chars — the title attr carries the rest. */
function truncateAvatar(persona: string | undefined): string {
  if (!persona) return '—'
  return persona.length > 40 ? `${persona.slice(0, 40).trimEnd()}…` : persona
}

function fmtUsd(value: number | undefined): string {
  if (value === undefined) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function Dashboard() {
  const navigate = useNavigate()

  const companiesQuery = useQuery<CompanySummary[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
  })
  const auditsQuery = useQuery<Audit[]>({ queryKey: ['audits'], queryFn: getAudits })
  // Costs endpoint may not be deployed yet — degrade to '—' instead of erroring.
  const costsQuery = useQuery({
    queryKey: ['costs', 'summary'],
    queryFn: getCostsSummary,
    retry: 0,
  })
  const monitored = useMonitoredCompanies()

  const companies = companiesQuery.data ?? []

  // Open content gaps, aggregated across all clients. Per-company failures
  // are tolerated — a missing client contributes 0 rather than breaking the stat.
  const gapsQuery = useQuery({
    queryKey: ['gaps', 'aggregate', companies.map((c) => c.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        companies.map((c) => getGaps(c.id).catch(() => [])),
      )
      return results.reduce(
        (n, gaps) => n + gaps.filter((g) => g.status !== 'done' && g.status !== 'dismissed').length,
        0,
      )
    },
    enabled: companies.length > 0,
  })

  if (companiesQuery.isError && auditsQuery.isError) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <div className="text-[14px] text-[#F06A6A]">Could not reach the API</div>
        <div className="text-[12px] text-[#5C5C66]">
          Is the backend running on {API_HOST}?
        </div>
      </div>
    )
  }

  const audits = auditsQuery.data ?? []
  const monthCalls = costsQuery.data?.totals.month.calls
  const monthUsd = costsQuery.data?.totals.month.estimatedUsd

  const recent = [...companies].slice(0, 8)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        kicker="LeadEngine · Live"
        title="Dashboard"
        description="Portfolio-wide view of AI visibility work — clients, audits, monitoring, and API spend."
        stats={[
          { label: 'Total clients', value: String(companies.length) },
          { label: 'Audits run', value: String(audits.length) },
          {
            label: 'API calls · month',
            value: monthCalls === undefined ? '—' : fmtInt(monthCalls),
            sub: monthUsd === undefined ? undefined : `${fmtUsd(monthUsd)} est.`,
          },
          {
            label: 'Open content gaps',
            value: gapsQuery.data === undefined ? '—' : String(gapsQuery.data),
            sub: 'across all clients',
          },
        ]}
      />

      {/* Summary tiles — one per top-level destination */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile
          label="Clients"
          metric={String(companies.length)}
          takeaway="companies under measurement"
          onClick={() => navigate('/clients')}
        />
        <SummaryTile
          label="Audit"
          metric={String(audits.length)}
          takeaway="run a new visibility audit"
          onClick={() => navigate('/audit')}
        />
        <SummaryTile
          label="Check-ups"
          metric={String(monitored.length)}
          takeaway="companies monitored weekly"
          onClick={() => navigate('/check-ups')}
        />
        <SummaryTile
          label="API Cost"
          metric={fmtUsd(monthUsd)}
          takeaway="estimated spend this month"
          onClick={() => navigate('/admin/costs')}
        />
      </div>

      {/* Recent clients */}
      <Card
        title="Recent Clients"
        meta={companies.length > 0 ? `${companies.length} total` : undefined}
        right={
          <button
            type="button"
            onClick={() => navigate('/clients')}
            className="text-[12px] text-[#8A8A93] transition-colors duration-150 hover:text-white"
          >
            View all →
          </button>
        }
      >
        {companiesQuery.isLoading ? (
          <PanelSkeleton lines={4} className="h-40" />
        ) : recent.length === 0 ? (
          <EmptyState>No clients yet. Run your first audit to onboard one.</EmptyState>
        ) : (
          <div>
            {/* Column header */}
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_100px_100px_110px] gap-3 border-b border-[#131316] px-3 py-2.5">
              {['Client', 'Sector', 'Avatar', 'Mentions', 'Citations', 'Status'].map((h, i) => (
                <div
                  key={h}
                  className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${i === 3 || i === 4 ? 'text-right' : ''}`}
                >
                  {h}
                </div>
              ))}
            </div>
            {recent.map((c, i) => (
              <div
                key={c.id}
                onClick={() => navigate(`/clients/${c.id}`)}
                style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                className="row stagger-item grid cursor-pointer grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_100px_100px_110px] items-center gap-3 border-b border-[#131316] px-3 py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-[#C9C9D1]" title={c.name}>
                    {c.name}
                  </div>
                  {c.job && (c.job.status === 'running' || c.job.status === 'pending') ? (
                    <PipelineStepper
                      variant="mini"
                      stage={c.job.stage}
                      status={c.job.status}
                      className="mt-1"
                    />
                  ) : (
                    c.website && (
                      <div className="truncate text-[11px] text-[#5C5C66]" title={c.website}>
                        {c.website}
                      </div>
                    )
                  )}
                </div>
                <div className="truncate text-[12px] text-[#8A8A93]" title={c.sector}>
                  {c.sector || '—'}
                </div>
                <div className="truncate text-[12px] text-[#8A8A93]" title={c.buyerPersona}>
                  {truncateAvatar(c.buyerPersona)}
                </div>
                <div className="text-right text-[12px] tabular-nums text-[#8A8A93]">
                  {pct(c.latestScore?.mentionRate)}
                </div>
                <div className="text-right text-[12px] tabular-nums text-[#8A8A93]">
                  {pct(c.latestScore?.citationRate)}
                </div>
                <div>
                  {c.job ? (
                    <Badge variant="status" color={STATUS_COLOR[c.job.status]}>{c.job.status}</Badge>
                  ) : (
                    <Badge color="#8A8A93">No jobs</Badge>
                  )}
                </div>
              </div>
            ))}
            {companies.length > recent.length && (
              <div className="pt-3 text-center text-[12px] text-[#5C5C66]">
                +{companies.length - recent.length} more clients
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
