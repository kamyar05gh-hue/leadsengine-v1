import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { format } from 'date-fns'
import { API_HOST, getCompanies, getTracking, type CompanySummary } from '@/lib/api'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Card } from '@/components/primitives/Card'
import { OutlineButton } from '@/components/primitives/Button'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { Sparkline } from '@/components/Sparkline'
import { useMonitoredCompanies, useMonitoringToggle } from '@/hooks/useMonitoring'

/** Percentages render to 2 decimals per the design system. */
function pct(value: number | undefined): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`
}

function fmtWeek(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `week of ${format(d, 'MMM d')}`
}

interface CompanyTracking {
  company: CompanySummary
  /** Mention-rate series, oldest first (fractions). */
  series: number[]
  latest: { weekStart: string; mentionRate: number; citationRate?: number } | null
}

function CompanyCard({ data, active }: { data: CompanyTracking; active: boolean }) {
  const navigate = useNavigate()
  const toggle = useMonitoringToggle(data.company.id)
  const { company, series, latest } = data

  return (
    <Card
      title={company.name}
      meta={[company.sector, company.location].filter(Boolean).join(' · ')}
      right={
        <div className="flex items-center gap-3">
          {active ? (
            <span className="flex items-center gap-2 text-[12px] text-[#A78BFA]">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#A78BFA]" />
              Active
            </span>
          ) : (
            <span className="flex items-center gap-2 text-[12px] text-[#5C5C66]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5C5C66]" />
              Paused
            </span>
          )}
          <OutlineButton
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(active)}
          >
            {active ? 'Pause' : 'Start'}
          </OutlineButton>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_160px]">
        <div>
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                Mention rate
              </div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-white">
                {pct(latest?.mentionRate)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                Citation rate
              </div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-white">
                {pct(latest?.citationRate)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[12px] tabular-nums text-[#5C5C66]">
            {latest ? fmtWeek(latest.weekStart) : 'No snapshots yet — first check-up runs weekly.'}
          </div>
          <button
            type="button"
            onClick={() => navigate(`/clients/${company.id}/tracking`)}
            className="mt-3 text-[12px] text-[#8A8A93] transition-colors duration-150 hover:text-white"
          >
            Open tracking →
          </button>
        </div>
        <div className="flex items-end">
          {series.length >= 2 ? (
            <Sparkline data={series.slice(-4)} className="w-full" />
          ) : (
            <div className="w-full text-right text-[11px] text-[#3F3F47]">no trend yet</div>
          )}
        </div>
      </div>
    </Card>
  )
}

/** Check-ups — monitoring control center for weekly re-measurement. */
export function Checkups() {
  const companiesQuery = useQuery<CompanySummary[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
  })
  const monitored = useMonitoredCompanies()

  const companies = companiesQuery.data ?? []

  // Latest tracking snapshot per company, fetched in parallel. Companies
  // without snapshots (404) contribute an empty series rather than failing.
  const trackingQuery = useQuery<CompanyTracking[]>({
    queryKey: ['check-ups', companies.map((c) => c.id).join(',')],
    queryFn: () =>
      Promise.all(
        companies.map(async (company) => {
          const data = await getTracking(company.id).catch(() => null)
          const points = data?.points ?? []
          const latestPoint = points.length > 0 ? points[points.length - 1] : null
          return {
            company,
            series: points.map((p) => p.mentionRate),
            latest: latestPoint
              ? {
                  weekStart: latestPoint.date,
                  mentionRate: latestPoint.mentionRate,
                  citationRate: latestPoint.citationRate,
                }
              : null,
          }
        }),
      ),
    enabled: companies.length > 0,
  })

  if (companiesQuery.isError) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <div className="text-[14px] text-[#F06A6A]">Could not reach the API</div>
        <div className="text-[12px] text-[#5C5C66]">
          Is the backend running on {API_HOST}?
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        kicker="Monitoring"
        title="Check-ups"
        description="Weekly re-measurement of key prompts across engines."
        stats={[
          { label: 'Clients', value: String(companies.length) },
          {
            label: 'Active',
            value: String(monitored.length),
            tone: monitored.length > 0 ? 'green' : 'gray',
            sub: 'monitored weekly',
          },
        ]}
      />

      {companiesQuery.isLoading || trackingQuery.isLoading ? (
        <PanelSkeleton lines={4} className="h-64" />
      ) : (trackingQuery.data ?? []).length === 0 ? (
        <EmptyState>No clients yet. Run an audit first, then arm its weekly check-up here.</EmptyState>
      ) : (
        (trackingQuery.data ?? []).map((d) => (
          <CompanyCard key={d.company.id} data={d} active={monitored.includes(d.company.id)} />
        ))
      )}
    </div>
  )
}
