import { format } from 'date-fns'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SentimentReport } from '@/lib/api'
import { CHART, axisTick, cursorStyle, tooltipLabelStyle, tooltipStyle } from '@/components/primitives/chartTheme'

/**
 * Sentiment colors per the design system: positive #A78BFA (light purple), neutral #5C5C66,
 * negative #F06A6A. Every slice is paired with a text label in the legend.
 */
const SENTIMENT_COLORS = {
  positive: '#A78BFA',
  neutral: '#5C5C66',
  negative: '#F06A6A',
} as const

type SentimentKey = keyof typeof SENTIMENT_COLORS

/**
 * SentimentDonut — positive / neutral / negative breakdown of judged AI
 * answers, with the positive share displayed in the donut center.
 */
export function SentimentDonut({ report }: { report: SentimentReport }) {
  if (report.total === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-[13px] text-[#5C5C66]">
        No sentiment data yet — answers are judged once the next audit run completes.
      </div>
    )
  }

  const slices: { key: SentimentKey; name: string; value: number }[] = (
    [
      { key: 'positive', name: 'Positive', value: report.positive },
      { key: 'neutral', name: 'Neutral', value: report.neutral },
      { key: 'negative', name: 'Negative', value: report.negative },
    ] as const
  ).filter((s) => s.value > 0)

  const positivePct = Math.round((report.positive / report.total) * 100)

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-48 w-48" role="img" aria-label={`Sentiment breakdown: ${positivePct}% positive`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={56}
              outerRadius={80}
              paddingAngle={slices.length > 1 ? 3 : 0}
              strokeWidth={0}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={SENTIMENT_COLORS[s.key]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(value, name) =>
                typeof value === 'number'
                  ? [`${value} answers (${Math.round((value / report.total) * 100)}%)`, name]
                  : [String(value), String(name)]
              }
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label — the headline number of the whole chart. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[24px] font-medium tabular-nums text-white">{positivePct}%</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
            positive
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 text-[12px] text-[#8A8A93]">
        {slices.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: SENTIMENT_COLORS[s.key] }}
            />
            {s.name}
            <span className="tabular-nums text-white">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * SentimentTrend — positive-mention share over time (per audit day), as an
 * area chart with a gradient fill. Needs >= 2 points to render.
 */
export function SentimentTrend({ trend }: { trend: SentimentReport['trend'] }) {
  if (trend.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-[13px] text-[#5C5C66]">
        Sentiment trend appears once answers have been judged on at least two different days.
      </div>
    )
  }

  const data = trend.map((p) => ({
    date: formatDay(p.at),
    positive: p.positivePct,
  }))

  return (
    <div className="h-56 w-full" role="img" aria-label="Positive-mention share over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="sentimentFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.green} stopOpacity={0.22} />
              <stop offset="100%" stopColor={CHART.green} stopOpacity={0} />
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
            formatter={(value) => (typeof value === 'number' ? `${value}% positive` : '—')}
          />
          <Area
            type="monotone"
            dataKey="positive"
            name="Positive share"
            stroke={CHART.green}
            strokeWidth={2}
            fill="url(#sentimentFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Compact day label for chart axes ("Aug 4"); falls back to the raw value. */
function formatDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d')
}
