import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { AlertTriangle, BookOpen, Database } from 'lucide-react'
import {
  getAdminDataset,
  getAdminOverview,
  getLearnings,
  type AdminOverview,
  type Learning,
} from '@/lib/api'
import { Card } from '@/components/primitives/Card'
import { StatBox } from '@/components/primitives/StatBox'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { DatasetTable } from '@/components/DatasetTable'
import { fmtInt, fmtPct } from '@/lib/format'

const ACCENT = '#A78BFA'
const DANGER = '#F06A6A'

/** Spend totals read as money, not as the sub-cent API-call amounts. */
function money(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Learning kinds in reading order; unknown kinds are appended as-is. */
const KIND_ORDER = ['prompt_pattern', 'insight', 'action', 'pitfall'] as const

const KIND_LABEL: Record<string, string> = {
  prompt_pattern: 'Prompt patterns',
  insight: 'Insights',
  action: 'Actions',
  pitfall: 'Pitfalls',
}

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/[_-]/g, ' ')
}

/** Pitfalls read as warnings; everything else wears the accent. */
function kindColor(kind: string): string {
  return kind === 'pitfall' ? DANGER : ACCENT
}

function kindOrder(kind: string): number {
  const i = (KIND_ORDER as readonly string[]).indexOf(kind)
  return i === -1 ? KIND_ORDER.length : i
}

/** A value bar drawn inside a table cell, number right-aligned on top. */
function BarCell({
  value,
  max,
  label,
  color = ACCENT,
}: {
  value: number
  max: number
  label: string
  color?: string
}) {
  const width = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className="relative h-[22px] w-full overflow-hidden rounded-[5px]"
      style={{ backgroundColor: '#0E0E11' }}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500"
        style={{ width: `${width}%`, backgroundColor: color, opacity: 0.3 }}
      />
      <div className="relative flex h-full items-center justify-end px-2 text-[11px] tabular-nums text-[#C9C9D1]">
        {label}
      </div>
    </div>
  )
}

function SectorTable({ rows }: { rows: AdminOverview['bySector'] }) {
  const maxMention = Math.max(1, ...rows.map((r) => r.avgMentionRate))
  const maxCitation = Math.max(1, ...rows.map((r) => r.avgCitationRate))
  if (rows.length === 0) return <EmptyState>No sector data yet.</EmptyState>
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_60px_minmax(0,1fr)_minmax(0,1fr)_80px] gap-3 border-b border-[#131316] px-3 py-2">
        {['Sector', 'Clients', 'Mention', 'Citation', 'Avg spend'].map((h, i) => (
          <div
            key={h}
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${
              i === 1 || i === 4 ? 'text-right' : ''
            }`}
          >
            {h}
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div
          key={r.sectorKey}
          className="row grid grid-cols-[minmax(0,1.4fr)_60px_minmax(0,1fr)_minmax(0,1fr)_80px] items-center gap-3 border-b border-[#131316] px-3 py-2 last:border-0"
        >
          <div className="truncate text-[12px] capitalize text-[#C9C9D1]" title={r.sectorKey}>
            {r.sectorKey || '—'}
          </div>
          <div className="text-right text-[12px] tabular-nums text-[#8A8A93]">
            {fmtInt(r.companies)}
          </div>
          <BarCell value={r.avgMentionRate} max={maxMention} label={fmtPct(r.avgMentionRate, 1)} />
          <BarCell
            value={r.avgCitationRate}
            max={maxCitation}
            label={fmtPct(r.avgCitationRate, 1)}
            color="#7C9BD4"
          />
          <div className="text-right text-[12px] tabular-nums text-[#8A8A93]">
            {money(r.avgUsd)}
          </div>
        </div>
      ))}
    </div>
  )
}

function EngineTable({ rows }: { rows: AdminOverview['byEngine'] }) {
  const maxMention = Math.max(1, ...rows.map((r) => r.avgMention))
  const maxCitation = Math.max(1, ...rows.map((r) => r.avgCitation))
  if (rows.length === 0) return <EmptyState>No engine data yet.</EmptyState>
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] gap-3 border-b border-[#131316] px-3 py-2">
        {['Engine', 'Mention', 'Citation'].map((h) => (
          <div
            key={h}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]"
          >
            {h}
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div
          key={r.engine}
          className="row grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] items-center gap-3 border-b border-[#131316] px-3 py-2 last:border-0"
        >
          <div className="truncate text-[12px] capitalize text-[#C9C9D1]">{r.engine}</div>
          <BarCell value={r.avgMention} max={maxMention} label={fmtPct(r.avgMention, 1)} />
          <BarCell
            value={r.avgCitation}
            max={maxCitation}
            label={fmtPct(r.avgCitation, 1)}
            color="#7C9BD4"
          />
        </div>
      ))}
    </div>
  )
}

/** How many lessons per kind before the "show all" expander kicks in. */
const LESSONS_COLLAPSED = 3

function LearningsPanel({ learnings }: { learnings: Learning[] }) {
  const [expandedKinds, setExpandedKinds] = useState<Set<string>>(new Set())

  const grouped = useMemo(() => {
    const byKind = new Map<string, Learning[]>()
    for (const l of learnings) {
      const list = byKind.get(l.kind)
      if (list) list.push(l)
      else byKind.set(l.kind, [l])
    }
    return [...byKind.entries()]
      .map(([kind, items]) => ({
        kind,
        items: [...items].sort((a, b) => b.weight - a.weight),
      }))
      .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))
  }, [learnings])

  const toggleKind = (kind: string) => {
    setExpandedKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  if (grouped.length === 0) {
    return (
      <EmptyState icon={BookOpen}>
        No lessons recorded yet — they accumulate as audits complete.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {grouped.map((group) => {
        const color = kindColor(group.kind)
        const expanded = expandedKinds.has(group.kind)
        const items = expanded ? group.items : group.items.slice(0, LESSONS_COLLAPSED)
        const hiddenCount = group.items.length - LESSONS_COLLAPSED
        return (
          <div key={group.kind}>
            <div className="mb-2 flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A93]">
                {kindLabel(group.kind)}
              </span>
              <span className="text-[11px] tabular-nums text-[#5C5C66]">{group.items.length}</span>
            </div>
            <div className="flex flex-col">
              {items.map((l) => (
                <div
                  key={`${l.kind}-${l.id}`}
                  className="row flex items-start gap-3 border-b border-[#131316] px-3 py-2.5 last:border-0"
                >
                  <span
                    className="mt-[1px] shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                    title={`Weight ${l.weight}`}
                    style={{
                      backgroundColor: `${color}1F`,
                      color,
                    }}
                  >
                    w{l.weight}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-relaxed text-[#C9C9D1]">{l.lesson}</div>
                    {l.evidence && (
                      <div className="mt-0.5 text-[11px] leading-relaxed text-[#5C5C66]">
                        {l.evidence}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] capitalize text-[#5C5C66]">
                    {l.sectorKey || l.scope || 'global'}
                  </span>
                </div>
              ))}
            </div>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => toggleKind(group.kind)}
                aria-expanded={expanded}
                className="mt-1.5 px-3 text-[11px] font-medium text-[#8A8A93] transition-colors duration-150 hover:text-white"
              >
                {expanded ? 'Show top 3' : `Show all ${group.items.length}`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * LeadEngine Data — the cross-client knowledge dataset: what the system has
 * measured, where it underperforms, and what it has learned.
 */
export function AdminData() {
  const overviewQuery = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: getAdminOverview,
    retry: 0,
  })
  const datasetQuery = useQuery({
    queryKey: ['admin', 'dataset'],
    queryFn: getAdminDataset,
    retry: 0,
  })
  const learningsQuery = useQuery({
    queryKey: ['learnings'],
    queryFn: getLearnings,
    retry: 0,
  })

  const overview = overviewQuery.data ?? null
  const dataset = datasetQuery.data ?? null
  const learnings = learningsQuery.data ?? []

  const generatedAt = dataset?.generatedAt ? new Date(dataset.generatedAt) : null
  const generatedLabel =
    generatedAt && !Number.isNaN(generatedAt.getTime())
      ? `generated ${format(generatedAt, 'MMM d, HH:mm')}`
      : undefined

  return (
    <div className="flex flex-col gap-5">
      {/* (a) KPI strip */}
      {overviewQuery.isLoading ? (
        <PanelSkeleton framed lines={2} className="h-[104px]" />
      ) : overviewQuery.isError ? (
        <EmptyState icon={Database}>
          The admin overview endpoint is not reachable — start the backend, or wait for
          <span className="text-[#8A8A93]"> /api/admin/overview </span>
          to ship.
        </EmptyState>
      ) : !overview ? (
        <EmptyState icon={Database}>
          No platform overview yet — no client has been audited so far.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          <StatBox label="Clients" value={fmtInt(overview.companies)} />
          <StatBox label="Audits" value={fmtInt(overview.audits)} />
          <StatBox label="API calls" value={fmtInt(overview.totalCalls)} />
          <StatBox label="Est. spend" value={money(overview.estimatedUsd)} />
          <StatBox label="Avg mention" value={fmtPct(overview.avgMentionRate)} />
          <StatBox label="Avg citation" value={fmtPct(overview.avgCitationRate)} />
        </div>
      )}

      {/* (b) Two-column: weak spots + per-engine (left) · learnings (right) */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {overview && (
          <Card
            title="System weak spots"
            meta={
              overview.weakSpots.length > 0
                ? `${overview.weakSpots.length} flagged`
                : 'nothing flagged'
            }
          >
            {overview.weakSpots.length === 0 ? (
              <div className="rounded-[10px] border border-[#131316] px-4 py-3 text-[13px] text-[#5C5C66]">
                No systemic weak spots detected in the current dataset.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {overview.weakSpots.map((spot) => (
                  <li
                    key={spot}
                    className="flex items-start gap-2.5 rounded-[10px] px-3 py-2.5"
                    style={{
                      border: '1px solid rgba(240,106,106,.22)',
                      backgroundColor: 'rgba(240,106,106,.06)',
                    }}
                  >
                    <AlertTriangle
                      size={14}
                      strokeWidth={1.75}
                      aria-hidden
                      className="mt-[2px] shrink-0 text-[#F06A6A]"
                    />
                    <span className="text-[13px] leading-relaxed text-[#C9C9D1]">{spot}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A93]">
                <Database size={13} strokeWidth={1.75} aria-hidden className="text-[#5C5C66]" />
                By engine
              </div>
              <EngineTable rows={overview.byEngine} />
            </div>
          </Card>
        )}

        {/* Accumulated learnings — collapsed to the top 3 per kind. */}
        <Card
          title="What we've learned"
          meta={
            learningsQuery.isLoading
              ? 'loading…'
              : `${fmtInt(learnings.length)} lesson${learnings.length === 1 ? '' : 's'}`
          }
          className={overview ? undefined : 'lg:col-span-2'}
        >
          {learningsQuery.isLoading ? (
            <PanelSkeleton lines={4} className="h-40" />
          ) : learningsQuery.isError ? (
            <EmptyState icon={BookOpen}>Learnings are unavailable — the backend is offline.</EmptyState>
          ) : (
            <LearningsPanel learnings={learnings} />
          )}
        </Card>
      </div>

      {/* (c) Per-sector performance — full width, only meaningful with >1 sector */}
      {overview && overview.bySector.length > 1 && (
        <Card title="Per-sector performance" meta={`${overview.bySector.length} sectors`}>
          <SectorTable rows={overview.bySector} />
        </Card>
      )}

      {/* (d) The dataset itself */}
      <Card
        title="Client dataset"
        meta={generatedLabel}
        right={
          dataset ? (
            <div className="flex shrink-0 items-center gap-5 text-[11px] tabular-nums text-[#5C5C66]">
              <span>{fmtInt(dataset.totals.companies)} clients</span>
              <span>{fmtInt(dataset.totals.snapshots)} snapshots</span>
              <span>{fmtInt(dataset.totals.apiCalls)} calls</span>
              <span>{money(dataset.totals.estimatedUsd)}</span>
            </div>
          ) : undefined
        }
      >
        {datasetQuery.isLoading ? (
          <PanelSkeleton lines={6} className="h-[320px]" />
        ) : datasetQuery.isError ? (
          <EmptyState icon={Database}>
            The dataset endpoint is not reachable — check that the backend is running.
          </EmptyState>
        ) : !dataset ? (
          <EmptyState icon={Database}>
            No dataset available yet — once client snapshots are collected they appear here.
          </EmptyState>
        ) : (
          <DatasetTable dataset={dataset} />
        )}
      </Card>
    </div>
  )
}
