import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfDay, subDays } from 'date-fns'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getCostsSummary, type CostBucket } from '@/lib/api'
import { CHART, SERIES, axisTick, cursorStyle, tooltipLabelStyle, tooltipStyle } from '@/components/primitives/chartTheme'
import { Card } from '@/components/primitives/Card'
import { StatBox } from '@/components/primitives/StatBox'
import { Badge } from '@/components/primitives/Badge'
import { Tabs } from '@/components/primitives/Tabs'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { fmtInt } from '@/lib/format'

type Range = 'today' | 'week' | 'month' | 'all'

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
]

/** Currency format per spec: $1,234.56 — always 2 decimals. */
function fmtUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d')
}

/** Chart caption per range, so the axis scope is always stated. */
const RANGE_META: Record<Range, string> = {
  today: 'today',
  week: 'last 7 days',
  month: 'last 30 days',
  all: 'all time',
}

/** Inclusive start of the charted window; null = no lower bound (all). */
function rangeStart(range: Range): Date | null {
  const today = startOfDay(new Date())
  if (range === 'today') return today
  if (range === 'week') return subDays(today, 6)
  if (range === 'month') return subDays(today, 29)
  return null
}

const KIND_COLOR = '#5B8DEF'

export function Costs() {
  const [range, setRange] = useState<Range>('month')

  const costsQuery = useQuery({
    queryKey: ['costs', 'summary'],
    queryFn: getCostsSummary,
    retry: 0,
  })
  const data = costsQuery.data

  if (costsQuery.isError) {
    return (
      <EmptyState>Cost data unavailable — the costs endpoint is not reachable yet.</EmptyState>
    )
  }

  const totals = data?.totals
  // KPI numbers come per-bucket from the API and follow the same range keys.
  const selected: CostBucket | undefined = totals?.[range]

  /**
   * The charted series follows the selected range: byDay is filtered to the
   * window client-side (today / last 7 / last 30 / everything). For "today"
   * a single bar is synthesized even when no calls were logged yet, so the
   * chart never renders as an empty line.
   */
  const rawByDay = data?.byDay ?? []
  const start = rangeStart(range)
  const windowed = start
    ? rawByDay.filter((d) => {
        const t = new Date(d.date)
        return !Number.isNaN(t.getTime()) && t.getTime() >= start.getTime()
      })
    : rawByDay
  const byDay =
    range === 'today' && windowed.length === 0
      ? [{ date: 'Today', calls: 0, estimatedUsd: 0 }]
      : windowed.map((d) => ({
          date: range === 'today' ? 'Today' : fmtDay(d.date),
          calls: d.calls,
          estimatedUsd: d.estimatedUsd,
        }))

  /** Sparse windows read better as bars than as a degenerate line. */
  const useBars = range === 'today' || byDay.length <= 2

  const byVendor = data?.byVendor ?? []
  const maxVendorCalls = Math.max(1, ...byVendor.map((v) => v.calls))

  return (
    <div className="flex flex-col gap-5">
      {/* Range totals — one summary call, filtered client-side */}
      <Card
        title="Totals"
        meta="selected range"
        right={
          <Tabs options={RANGE_OPTIONS} value={range} onChange={setRange} ariaLabel="Cost range" />
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
          <StatBox
            label="API calls"
            value={costsQuery.isLoading || !selected ? '—' : fmtInt(selected.calls)}
          />
          <StatBox
            label="Estimated spend"
            value={costsQuery.isLoading || !selected ? '—' : fmtUsd(selected.estimatedUsd)}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* Calls per day — follows the selected range */}
        <Card title="Calls per day" meta={RANGE_META[range]} className="lg:col-span-3">
          {costsQuery.isLoading ? (
            <PanelSkeleton lines={4} className="h-64" />
          ) : byDay.length === 0 ? (
            <EmptyState>
              {range === 'all' ? 'No calls recorded yet.' : `No calls recorded in the ${RANGE_META[range]}.`}
            </EmptyState>
          ) : (
            <div
              className="h-64 w-full"
              role="img"
              aria-label={`API calls per day, ${RANGE_META[range]}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                {useBars ? (
                  /* One or two days: bars, not a degenerate line. */
                  <BarChart data={byDay} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={{ fill: 'rgba(255,255,255,0.028)' }}
                      formatter={(value) => (typeof value === 'number' ? fmtInt(value) : '—')}
                    />
                    <Bar dataKey="calls" name="Calls" fill={CHART.line} maxBarSize={64} radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <AreaChart data={byDay} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <defs>
                      <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.line} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={CHART.line} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={cursorStyle}
                      formatter={(value) => (typeof value === 'number' ? fmtInt(value) : '—')}
                    />
                    <Area
                      type="monotone"
                      dataKey="calls"
                      name="Calls"
                      stroke={CHART.line}
                      strokeWidth={2}
                      fill="url(#callsFill)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* By vendor — pre-aggregated by the API, cannot be re-scoped client-side */}
        <Card title="By vendor" meta="all time" className="lg:col-span-2">
          {costsQuery.isLoading ? (
            <PanelSkeleton lines={4} className="h-64" />
          ) : byVendor.length === 0 ? (
            <EmptyState>No vendor data yet.</EmptyState>
          ) : (
            <div
              style={{ height: Math.max(120, byVendor.length * 44) }}
              role="img"
              aria-label="API calls by vendor"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byVendor} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={CHART.grid} horizontal={false} />
                  <XAxis type="number" hide domain={[0, maxVendorCalls]} />
                  <YAxis
                    type="category"
                    dataKey="vendor"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    width={90}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    cursor={{ fill: 'rgba(255,255,255,0.028)' }}
                    formatter={(value, name) =>
                      name === 'calls' && typeof value === 'number' ? fmtInt(value) : value
                    }
                  />
                  <Bar dataKey="calls" name="calls" maxBarSize={14} radius={[0, 4, 4, 0]}>
                    {byVendor.map((v, i) => (
                      <Cell
                        key={v.vendor}
                        fill={v.calls === 0 ? '#1C1C21' : SERIES[i % SERIES.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* By model — pre-aggregated by the API, cannot be re-scoped client-side */}
      <Card title="By model" meta={data ? `${data.byModel.length} models · all time` : 'all time'}>
        {costsQuery.isLoading ? (
          <PanelSkeleton lines={4} className="h-40" />
        ) : !data || data.byModel.length === 0 ? (
          <EmptyState>No model data yet.</EmptyState>
        ) : (
          <div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_110px_90px_120px] gap-3 border-b border-[#131316] px-3 py-2.5">
              {['Vendor', 'Model', 'Kind', 'Calls', 'Est. USD'].map((h, i) => (
                <div
                  key={h}
                  className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${i >= 3 ? 'text-right' : ''}`}
                >
                  {h}
                </div>
              ))}
            </div>
            {data.byModel.map((m) => (
              <div
                key={`${m.vendor}-${m.model}`}
                className="row grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_110px_90px_120px] items-center gap-3 border-b border-[#131316] px-3 py-2.5 last:border-0"
              >
                <div className="truncate text-[13px] text-[#C9C9D1]" title={m.vendor}>
                  {m.vendor}
                </div>
                <div className="truncate text-[13px] text-[#C9C9D1]" title={m.model}>
                  {m.model}
                </div>
                <div>
                  <Badge color={KIND_COLOR}>{m.kind}</Badge>
                </div>
                <div className="text-right text-[12px] tabular-nums text-[#8A8A93]">
                  {fmtInt(m.calls)}
                </div>
                <div className="text-right text-[12px] tabular-nums text-[#8A8A93]">
                  {fmtUsd(m.estimatedUsd)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
