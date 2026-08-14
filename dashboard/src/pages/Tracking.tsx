import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getAiTraffic, getFreshness, getTracking, runTrackingNow } from '@/lib/api'
import type { FreshnessReason } from '@/lib/api'
import { PrimaryButton } from '@/components/primitives/Button'
import { CHART, axisTick, cursorStyle, tooltipLabelStyle, tooltipStyle } from '@/components/primitives/chartTheme'
import { Card } from '@/components/primitives/Card'
import { Tabs } from '@/components/primitives/Tabs'
import { Badge } from '@/components/primitives/Badge'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { SentimentTrend } from '@/components/SentimentChart'
import { TrendIndicator } from '@/components/TrendIndicator'

const RANGE_OPTIONS = [
  { value: '4w', label: 'Last 4 weeks', days: 28 },
  { value: '12w', label: 'Last 12 weeks', days: 84 },
  { value: 'all', label: 'All time', days: Infinity },
]

/** A change is "significant" at ±5 percentage points or more. */
const SIGNIFICANT_DELTA = 0.05
const MAX_TIMELINE_ITEMS = 8

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d')
}

/** Timeline dot color by change semantics — always paired with text. */
function changeColor(type: string, delta?: number | null): string {
  if (delta !== null && delta !== undefined) return delta >= 0 ? '#A78BFA' : '#F06A6A'
  if (type === 'New competitor') return '#E8A04C'
  if (type === 'Competitor lost') return '#F06A6A'
  return '#5C5C66'
}

/** Freshness reason → status tone (paired with the badge text). */
const FRESHNESS_COLORS: Record<FreshnessReason, string> = {
  undated: '#E3C75A',
  stale: '#E8A04C',
  'no-main-links': '#F06A6A',
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function Tracking() {
  // Scoped to the client route — the client detail shell owns the header.
  const { id: companyId } = useParams<{ id: string }>()
  const [range, setRange] = useState('12w')
  // Reference time captured once on mount (impure calls are not allowed
  // during render; a dashboard "now" does not need to tick).
  const [now] = useState(() => Date.now())

  const queryClient = useQueryClient()

  const trackingQuery = useQuery({
    queryKey: ['tracking', companyId],
    queryFn: () => getTracking(companyId!),
    enabled: Boolean(companyId),
  })
  const data = trackingQuery.data ?? { points: [], changes: [] }

  // Manual check-up: live re-query of the key prompts across the AI engines.
  // Takes 1-3 minutes; on success the new snapshot + change feed are refetched.
  const checkup = useMutation({
    mutationFn: () => runTrackingNow(companyId!),
    onSuccess: () => {
      // A live check-up also moves crawler traffic and content freshness.
      void queryClient.invalidateQueries({ queryKey: ['tracking', companyId] })
      void queryClient.invalidateQueries({ queryKey: ['ai-traffic', companyId] })
      void queryClient.invalidateQueries({ queryKey: ['freshness', companyId] })
    },
  })

  const aiTrafficQuery = useQuery({
    queryKey: ['ai-traffic', companyId],
    queryFn: () => getAiTraffic(companyId!),
    enabled: Boolean(companyId),
  })
  const aiTraffic = aiTrafficQuery.data

  const freshnessQuery = useQuery({
    queryKey: ['freshness', companyId],
    queryFn: () => getFreshness(companyId!),
    enabled: Boolean(companyId),
  })
  const freshness = freshnessQuery.data ?? { checked: 0, stale: [] }

  const chartData = useMemo(() => {
    const days = RANGE_OPTIONS.find((r) => r.value === range)?.days ?? Infinity
    const cutoff = days === Infinity ? null : now - days * 24 * 60 * 60 * 1000
    return data.points
      .filter((p) => (cutoff === null ? true : new Date(p.date).getTime() >= cutoff))
      .map((p) => ({
        date: fmtDay(p.date),
        mentionRate: Math.round(p.mentionRate * 100),
        citationRate: p.citationRate === undefined ? undefined : Math.round(p.citationRate * 100),
      }))
  }, [data.points, range, now])

  // Sentiment trend from weekly snapshots that carried a judged share.
  const sentimentTrend = useMemo(
    () =>
      data.points
        .filter((p) => p.sentimentPosPct !== null && p.sentimentPosPct !== undefined)
        .map((p) => ({ at: p.date, positivePct: p.sentimentPosPct as number })),
    [data.points],
  )

  const changes = data.changes

  // Significant rate movements in the selected window — surfaced as alerts.
  const alerts = useMemo(
    () =>
      changes.filter(
        (c) => c.delta !== null && c.delta !== undefined && Math.abs(c.delta) >= SIGNIFICANT_DELTA,
      ),
    [changes],
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Manual check-up trigger — live re-query of the AI engines. */}
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton
          onClick={() => checkup.mutate()}
          disabled={checkup.isPending || !companyId}
          aria-label="Run check-up now"
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw
              size={14}
              strokeWidth={1.5}
              className={checkup.isPending ? 'animate-spin' : undefined}
            />
            {checkup.isPending ? 'Check-up running…' : 'Run check-up now'}
          </span>
        </PrimaryButton>
        {checkup.isPending && (
          <span className="text-[12px] text-[#8A8A93]" role="status">
            Re-querying AI engines… this can take 1–3 minutes.
          </span>
        )}
        {checkup.isError && !checkup.isPending && (
          <span className="text-[12px] text-[#F06A6A]" role="alert">
            {checkup.error instanceof Error ? checkup.error.message : 'Check-up failed'}
          </span>
        )}
        {checkup.isSuccess && !checkup.isPending && (
          <span className="text-[12px] text-[#8A8A93]" role="status">
            Check-up complete — snapshot updated.
          </span>
        )}
      </div>

      {/* Change alerts — only rendered when something significant moved. */}
      {alerts.length > 0 && (
        <div className="rounded-[10px] border border-[#16161A] bg-[#0E0E11] px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#E8A04C]">
            <TriangleAlert size={14} strokeWidth={1.5} />
            {alerts.length} significant change{alerts.length === 1 ? '' : 's'} detected
          </div>
          {alerts.slice(0, 3).map((a) => (
            <div key={a.id} className="mt-1.5 flex items-center gap-3 text-[12px] text-[#8A8A93]">
              <span className="w-14 shrink-0 tabular-nums text-[#5C5C66]">{fmtDay(a.date)}</span>
              <TrendIndicator delta={Math.round((a.delta ?? 0) * 100)} />
              <span className="truncate" title={a.description}>
                {a.description}
              </span>
            </div>
          ))}
        </div>
      )}

      <Card
        title="Visibility Over Time"
        meta="mention and citation rate"
        right={
          <Tabs
            options={RANGE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
            value={range}
            onChange={setRange}
            ariaLabel="Time range"
          />
        }
      >
        {trackingQuery.isLoading ? (
          <PanelSkeleton lines={5} className="h-72" />
        ) : chartData.length === 0 ? (
          <EmptyState>
            No tracking data yet. A baseline snapshot is written when an audit completes — or run a
            check-up now.
          </EmptyState>
        ) : (
          <div className="h-72 w-full" role="img" aria-label="Mention and citation rate over time">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="trackMentionFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.green} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={CHART.green} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="trackCitationFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.line} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={CHART.line} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  cursor={cursorStyle}
                  formatter={(value) => (typeof value === 'number' ? `${value}%` : '—')}
                />
                <Legend
                  iconSize={8}
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12, color: '#8A8A93' }}
                />
                <Area
                  type="monotone"
                  dataKey="mentionRate"
                  name="Mention rate"
                  stroke={CHART.green}
                  strokeWidth={2}
                  fill="url(#trackMentionFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="citationRate"
                  name="Citation rate"
                  stroke={CHART.line}
                  strokeWidth={2}
                  fill="url(#trackCitationFill)"
                  dot={false}
                  connectNulls
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Sentiment tracking — positive-mention share week over week */}
      <Card title="Sentiment Tracking" meta="positive-mention share across judged answers">
        {trackingQuery.isLoading ? (
          <PanelSkeleton lines={4} className="h-56" />
        ) : (
          <SentimentTrend trend={sentimentTrend} />
        )}
      </Card>

      {/* Change feed — timeline: vertical hairline rail, haloed dots, timestamp + truncated text */}
      <Card title="Recent Changes" meta={changes.length > 0 ? `${changes.length} in this period` : undefined}>
        {trackingQuery.isLoading ? (
          <PanelSkeleton lines={3} className="h-32" />
        ) : changes.length === 0 ? (
          <EmptyState>No changes detected in this period.</EmptyState>
        ) : (
          <div>
            <div className="ml-[5px] border-l border-[#131316] pl-5">
              {changes.slice(0, MAX_TIMELINE_ITEMS).map((change) => (
                <div key={change.id} className="relative flex items-center gap-3 py-2.5">
                  {/* Dot with card-colored halo */}
                  <span
                    className="absolute -left-[26px] h-2.5 w-2.5 rounded-full ring-4 ring-[#0B0B0D]"
                    style={{ backgroundColor: changeColor(change.type, change.delta) }}
                  />
                  <span className="w-14 shrink-0 text-[11px] tabular-nums text-[#5C5C66]">
                    {fmtDay(change.date)}
                  </span>
                  <span className="shrink-0 text-[12px] text-[#C9C9D1]">{change.type}</span>
                  <span className="min-w-0 truncate text-[12px] text-[#8A8A93]" title={change.description}>
                    {change.description}
                  </span>
                  <span className="ml-auto shrink-0 text-[12px]">
                    <TrendIndicator
                      delta={
                        change.delta === null || change.delta === undefined
                          ? null
                          : Math.round(change.delta * 100)
                      }
                    />
                  </span>
                </div>
              ))}
            </div>
            {changes.length > MAX_TIMELINE_ITEMS && (
              <div className="pt-3 text-[12px] text-[#5C5C66]">
                +{changes.length - MAX_TIMELINE_ITEMS} more changes in this period
              </div>
            )}
          </div>
        )}
      </Card>

      {/* AI Traffic — human visits from AI citations vs. AI crawler fetches. */}
      <Card title="AI Traffic" meta="crawler fetches + human visits from AI citations">
        {aiTrafficQuery.isLoading ? (
          <PanelSkeleton lines={4} className="h-48" />
        ) : !aiTraffic ||
          (aiTraffic.botVisits.total === 0 && aiTraffic.humanReferrals.total === 0) ? (
          <EmptyState>
            No AI traffic recorded yet. Crawler visits appear once AI bots fetch the hosted pages.
          </EmptyState>
        ) : (
          <div className="grid gap-8 lg:grid-cols-5">
            {/* Human visits from AI citations (primary, 3/5) */}
            <div className="lg:col-span-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                Human visits from AI citations
              </div>
              <div className="mt-2.5 text-[24px] font-medium tabular-nums text-white">
                {aiTraffic.humanReferrals.total}
              </div>

              {aiTraffic.humanReferrals.byReferrer.length > 0 && (
                <div className="mt-4 flex flex-col gap-1">
                  {aiTraffic.humanReferrals.byReferrer.map((r) => (
                    <div key={r.referrer} className="row -mx-2 flex items-center gap-3 px-2 py-1.5">
                      <span className="w-20 shrink-0 text-[12px] text-[#C9C9D1]">{r.referrer}</span>
                      <div className="h-1.5 min-w-0 flex-1 rounded-full bg-[#16161A]">
                        <div
                          className="h-1.5 rounded-full bg-[#69bff3]"
                          style={{
                            width: `${Math.max(
                              4,
                              (r.count /
                                Math.max(
                                  ...aiTraffic.humanReferrals.byReferrer.map((x) => x.count),
                                )) *
                                100,
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-white">
                        {r.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {aiTraffic.humanReferrals.topPages.length > 0 && (
                <div className="mt-5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5C5C66]">
                    Top landing pages
                  </div>
                  <div className="mt-1 flex flex-col">
                    {aiTraffic.humanReferrals.topPages.slice(0, 5).map((p) => (
                      <div key={p.page} className="row -mx-2 flex items-center gap-3 px-2 py-1.5">
                        <span className="min-w-0 truncate text-[12px] text-[#8A8A93]" title={p.page}>
                          {p.page}
                        </span>
                        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-white">
                          {p.count}
                        </span>
                      </div>
                    ))}
                    {aiTraffic.humanReferrals.topPages.length > 5 && (
                      <div className="pt-1 text-[12px] text-[#5C5C66]">
                        +{aiTraffic.humanReferrals.topPages.length - 5} more pages
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* AI crawler visits (secondary, 2/5) */}
            <div className="lg:col-span-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                AI crawler visits
              </div>
              <div className="mt-2.5 text-[24px] font-medium tabular-nums text-white">
                {aiTraffic.botVisits.total}
              </div>

              {aiTraffic.botVisits.byBot.length === 0 ? (
                <div className="mt-4 text-[12px] text-[#5C5C66]">
                  No crawler visits logged yet.
                </div>
              ) : (
                <div className="mt-4 flex flex-col">
                  {aiTraffic.botVisits.byBot.map((b) => (
                    <div key={b.bot} className="row -mx-2 flex items-center gap-3 px-2 py-1.5">
                      <span className="min-w-0 truncate text-[12px] text-[#C9C9D1]" title={b.bot}>
                        {b.bot}
                      </span>
                      <span className="ml-auto shrink-0 text-[12px] tabular-nums text-white">
                        {b.count}
                      </span>
                      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[#5C5C66]">
                        {fmtDay(b.lastSeen)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {aiTraffic.botVisits.topPages.length > 0 && (
                <div className="mt-5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5C5C66]">
                    Top crawled pages
                  </div>
                  <div className="mt-1 flex flex-col">
                    {aiTraffic.botVisits.topPages.slice(0, 5).map((p) => (
                      <div key={p.path} className="row -mx-2 flex items-center gap-3 px-2 py-1.5">
                        <span className="min-w-0 truncate text-[12px] text-[#8A8A93]" title={p.path}>
                          {p.path}
                        </span>
                        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-white">
                          {p.count}
                        </span>
                      </div>
                    ))}
                    {aiTraffic.botVisits.topPages.length > 5 && (
                      <div className="pt-1 text-[12px] text-[#5C5C66]">
                        +{aiTraffic.botVisits.topPages.length - 5} more pages
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Content freshness — weekly check-up of generated landing pages. */}
      <Card
        title="Content Freshness"
        meta={`${freshness.checked} pages checked · ${freshness.stale.length} need attention`}
      >
        {freshnessQuery.isLoading ? (
          <PanelSkeleton lines={3} className="h-32" />
        ) : freshness.checked === 0 ? (
          <EmptyState>
            No freshness check yet. Generated pages are checked every Sunday.
          </EmptyState>
        ) : freshness.stale.length === 0 ? (
          <EmptyState>All generated pages are fresh and linked to the main site.</EmptyState>
        ) : (
          <div className="flex flex-col">
            {freshness.stale.map((row, i) => (
              <div key={`${row.path}-${row.reason}-${i}`} className="row -mx-2 flex items-center gap-3 px-2 py-1.5">
                <span className="min-w-0 truncate text-[12px] text-[#C9C9D1]" title={row.path}>
                  {basename(row.path)}
                </span>
                <span className="shrink-0">
                  <Badge color={FRESHNESS_COLORS[row.reason] ?? '#8A8A93'}>{row.reason}</Badge>
                </span>
                <span className="ml-auto min-w-0 truncate text-[12px] text-[#8A8A93]" title={row.detail}>
                  {row.detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
