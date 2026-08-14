import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CitationDomain } from '@/lib/api'
import { SERIES, axisTick, cursorStyle, tooltipLabelStyle, tooltipStyle } from '@/components/primitives/chartTheme'

const OPPORTUNITY = '#E8A04C'
const EMPTY_BAR = '#1C1C21'
const MAX_DOMAINS = 10
const ROW_HEIGHT = 34

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

/**
 * CitationSupplyChainGraph — cited domains ranked by total citation volume
 * as a horizontal bar chart. Opportunity domains (competitors cited, the
 * company absent) are drawn in warning #E8A04C; everything else in series
 * blue. Bars: maxBarSize 14, radius on the value end only.
 */
export function CitationSupplyChainGraph({
  domains,
  companyName = 'You',
  className,
}: {
  domains: CitationDomain[]
  companyName?: string
  className?: string
}) {
  if (domains.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[#5C5C66]">
        No citation supply chain data yet.
      </div>
    )
  }

  const rows = [...domains]
    .map((d) => ({
      domain: d.domain,
      total: d.companyCitations + d.competitorCitations,
      opportunity: d.companyCitations === 0 && d.competitorCitations > 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_DOMAINS)

  const opportunities = rows.filter((r) => r.opportunity).length

  return (
    <div className={className}>
      {/* Legend — every colored mark carries a text label. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-[#8A8A93]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SERIES[0] }} />
          Cited domains ({companyName})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: OPPORTUNITY }} />
          Opportunity — competitors cited, you absent
          {opportunities > 0 && <span className="tabular-nums text-white">{opportunities}</span>}
        </span>
      </div>

      <div
        style={{ height: rows.length * ROW_HEIGHT + 16 }}
        role="img"
        aria-label="Cited domains ranked by citation volume"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="#1a1a1a" horizontal={false} />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="domain"
              width={170}
              tick={{ fill: '#8A8A93', fontSize: 12 }}
              tickFormatter={(d: string) => truncate(d, 24)}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              cursor={{ ...cursorStyle, fill: 'rgba(255,255,255,0.028)' }}
              formatter={(value) => [`${value} citations`, 'Total']}
            />
            <Bar dataKey="total" maxBarSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell
                  key={r.domain}
                  fill={r.total === 0 ? EMPTY_BAR : r.opportunity ? OPPORTUNITY : SERIES[0]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
