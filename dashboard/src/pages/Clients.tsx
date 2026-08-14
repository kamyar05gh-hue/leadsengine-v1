import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { API_HOST, getAudits, getCompanies, type Audit, type CompanySummary } from '@/lib/api'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Card } from '@/components/primitives/Card'
import { Badge } from '@/components/primitives/Badge'
import { OutlineButton } from '@/components/primitives/Button'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { PipelineStepper } from '@/components/PipelineStepper'
import { DeleteCompanyDialog } from '@/components/DeleteCompanyDialog'
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

function isThisMonth(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

/** A job that is still occupying the pipeline (blocks deletion, shows live). */
function isLiveJob(status: Audit['status']): boolean {
  // Must match the backend's delete guard (running | queued), plus 'pending'
  // for older records — otherwise the delete dialog offers no cancel path.
  return status === 'running' || status === 'queued' || status === 'pending'
}

export function Clients() {
  const navigate = useNavigate()
  const [deleteTarget, setDeleteTarget] = useState<CompanySummary | null>(null)

  const companiesQuery = useQuery<CompanySummary[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
  })
  const auditsQuery = useQuery<Audit[]>({ queryKey: ['audits'], queryFn: getAudits })
  const monitored = useMonitoredCompanies()

  const companies = companiesQuery.data ?? []
  const auditsThisMonth = (auditsQuery.data ?? []).filter((a) => isThisMonth(a.createdAt)).length

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
        kicker="Portfolio"
        title="Clients"
        description="Every company under measurement — latest visibility score and pipeline status."
        stats={[
          { label: 'Total clients', value: String(companies.length) },
          {
            label: 'Active check-ups',
            value: String(monitored.length),
            tone: monitored.length > 0 ? 'green' : 'gray',
            sub: 'monitored weekly',
          },
          { label: 'Audits this month', value: String(auditsThisMonth) },
        ]}
      />

      <div className="flex justify-end">
        <OutlineButton onClick={() => navigate('/audit')}>New Audit</OutlineButton>
      </div>

      <Card title="All clients" meta={companies.length > 0 ? `${companies.length} total` : undefined}>
        {companiesQuery.isLoading ? (
          <PanelSkeleton lines={4} className="h-40" />
        ) : companies.length === 0 ? (
          <EmptyState>No clients yet. Run your first audit to onboard one.</EmptyState>
        ) : (
          <div>
            {/* Header */}
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_90px_90px_110px_32px] gap-3 border-b border-[#131316] px-3 py-2.5">
              {['Client', 'Sector', 'Location', 'Mention', 'Citation', 'Status', ''].map((h, i) => (
                <div
                  key={h || `col-${i}`}
                  className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${i === 3 || i === 4 ? 'text-right' : ''}`}
                >
                  {h}
                </div>
              ))}
            </div>
            {companies.map((c, i) => (
              <div
                key={c.id}
                onClick={() => navigate(`/clients/${c.id}`)}
                style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                className="row stagger-item grid cursor-pointer grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_90px_90px_110px_32px] items-center gap-3 border-b border-[#131316] px-3 py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-[#C9C9D1]" title={c.name}>
                    {c.name}
                  </div>
                  {c.job && isLiveJob(c.job.status) ? (
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
                <div className="truncate text-[12px] text-[#8A8A93]" title={c.location}>
                  {c.location || '—'}
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
                <button
                  type="button"
                  aria-label={`Delete ${c.name}`}
                  title={`Delete ${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(c)
                  }}
                  className="group flex h-7 w-7 items-center justify-center justify-self-end rounded-[8px]"
                >
                  <span className="text-[#5C5C66] transition-colors duration-150 group-hover:text-[#F06A6A]">
                    <Trash2 size={14} strokeWidth={1.5} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {deleteTarget && (
        <DeleteCompanyDialog
          companyId={deleteTarget.id}
          companyName={deleteTarget.name}
          jobId={deleteTarget.job && isLiveJob(deleteTarget.job.status) ? deleteTarget.job.id : null}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
