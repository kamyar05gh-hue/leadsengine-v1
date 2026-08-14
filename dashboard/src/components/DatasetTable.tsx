import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUpRight, Download, RefreshCw, Search } from 'lucide-react'
import {
  DATASET_GROUPS,
  collectDatasetSnapshot,
  datasetCsvUrl,
  type AdminDataset,
  type DatasetCell,
  type DatasetColumn,
  type DatasetRow,
} from '@/lib/api'
import { Badge } from '@/components/primitives/Badge'
import { EmptyState } from '@/components/primitives/EmptyState'
import { fmtInt } from '@/lib/format'

/** Header-row heights — the second sticky header row offsets by the first. */
const GROUP_ROW_H = 26
const LABEL_ROW_H = 32
/** How many rows enter the DOM per reveal step (keeps huge datasets light). */
const PAGE_SIZE = 60

const GROUP_LABEL: Record<string, string> = {
  profile: 'Profile',
  setup: 'Setup',
  performance: 'Performance',
  market: 'Market',
  delivery: 'Delivery',
  movement: 'Movement',
  efficiency: 'Efficiency',
  learning: 'Learning',
}

function groupLabel(group: string): string {
  return GROUP_LABEL[group] ?? group.replace(/[_-]/g, ' ')
}

/** Stable ordering: known groups in canonical order, unknown ones after. */
function groupOrder(group: string): number {
  const i = (DATASET_GROUPS as readonly string[]).indexOf(group)
  return i === -1 ? DATASET_GROUPS.length : i
}

function formatCell(value: DatasetCell): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    return Number.isInteger(value) ? fmtInt(value) : value.toFixed(2)
  }
  return value
}

/** Company id for the row, when the dataset carries one. */
function rowCompanyId(row: DatasetRow): string | null {
  for (const key of ['companyId', 'company_id', 'id']) {
    const v = row[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

/** Identity for React keys — company id when present, else the row index. */
function rowKey(row: DatasetRow, index: number): string {
  return rowCompanyId(row) ?? `row-${index}`
}

/** Columns the search box looks at: company / sector / location fields. */
const SEARCH_KEY = /^(company|companyname|company_name|name|sector|sectorkey|sector_key|location|city|region|country)$/i

/** Long-text columns: clamped to one line in the row, full text in the expander. */
const CLAMP_KEY = /^(avatar|what_worked|what_did_not|niche_services|locations|top_cited_domains|per_engine|sector)$/i

/** Snapshot-event columns rendered with the editorial tag style. */
const KIND_KEY = /^(kind|snapshot_kind|snapshotkind)$/i

/** Movement columns: positive deltas purple, negative red. */
const DELTA_KEY = /(_delta|_change)$/i

const KIND_TONE: Record<string, string> = {
  audit: '#A78BFA',
  weekly: '#5B8DEF',
  monthly: '#7C9BD4',
  manual: '#8A8A93',
}

/** Delta cells carry their sign so movement reads at a glance. */
function formatDelta(value: number): string {
  const body = Number.isInteger(value) ? fmtInt(Math.abs(value)) : Math.abs(value).toFixed(2)
  if (value > 0) return `+${body}`
  if (value < 0) return `−${body}`
  return body
}

export function DatasetTable({ dataset }: { dataset: AdminDataset }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)

  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const columns = dataset.columns
  const firstColumn: DatasetColumn | undefined = columns[0]

  /** Groups actually present, in canonical order. */
  const groups = useMemo(() => {
    const present = [...new Set(columns.map((c) => c.group))]
    return present.sort((a, b) => groupOrder(a) - groupOrder(b))
  }, [columns])

  /**
   * Visible columns sorted by group so the group header row can span
   * contiguous runs. The first column (the company) is always pinned
   * leftmost and never hidden by a group filter.
   */
  const visibleColumns = useMemo(() => {
    const rest = columns
      .slice(1)
      .filter((c) => !hidden.has(c.group))
      .map((c, i) => ({ c, i }))
      .sort((a, b) => groupOrder(a.c.group) - groupOrder(b.c.group) || a.i - b.i)
      .map((x) => x.c)
    return firstColumn ? [firstColumn, ...rest] : rest
  }, [columns, firstColumn, hidden])

  /** Contiguous group runs for the top header row. */
  const groupSpans = useMemo(() => {
    const spans: { group: string; span: number }[] = []
    for (const col of visibleColumns) {
      const last = spans[spans.length - 1]
      if (last && last.group === col.group) last.span += 1
      else spans.push({ group: col.group, span: 1 })
    }
    return spans
  }, [visibleColumns])

  /** Keys the search matches against; falls back to every string cell. */
  const searchKeys = useMemo(() => {
    const named = columns.filter((c) => SEARCH_KEY.test(c.key)).map((c) => c.key)
    return named.length > 0 ? named : columns.map((c) => c.key)
  }, [columns])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return dataset.rows
    return dataset.rows.filter((row) =>
      searchKeys.some((key) => {
        const v = row[key]
        return typeof v === 'string' && v.toLowerCase().includes(q)
      }),
    )
  }, [dataset.rows, search, searchKeys])

  /** A new query starts at the top, one page deep. */
  const onSearch = (value: string) => {
    setSearch(value)
    setVisibleCount(PAGE_SIZE)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  const collect = useMutation({
    mutationFn: (companyId: string) => collectDatasetSnapshot(companyId),
    onSuccess: () => {
      toast.success('Snapshot collected')
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (err: Error) => toast.error(err.message || 'Could not collect a snapshot'),
  })

  const toggleGroup = (group: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      setVisibleCount((c) => (c >= filteredRows.length ? c : c + PAGE_SIZE))
    }
  }

  const rows = filteredRows.slice(0, visibleCount)
  const colCount = visibleColumns.length

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: search + group chips left, row count + CSV export right */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex w-full min-w-[200px] max-w-[280px] items-center">
          <Search
            size={14}
            strokeWidth={1.5}
            aria-hidden
            className="pointer-events-none absolute left-3 text-[#5C5C66]"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search company, sector or location…"
            aria-label="Search dataset rows"
            className="w-full rounded-[10px] py-2 pl-9 pr-3 text-[13px] text-[#C9C9D1] placeholder:text-[#5C5C66] focus:outline-none"
            style={{ border: '1px solid #16161A', backgroundColor: '#0E0E11' }}
          />
        </label>

        {/* Group chips — editorial tag style, active = visible column group. */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Column groups">
          {groups.map((group) => {
            const active = !hidden.has(group)
            return (
              <button
                key={group}
                type="button"
                aria-pressed={active}
                onClick={() => toggleGroup(group)}
                className="rounded-[4px] px-2 py-[5px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em] transition-colors duration-150"
                style={
                  active
                    ? { backgroundColor: '#A78BFA1F', color: '#A78BFA' }
                    : { backgroundColor: '#8A8A9314', color: '#6B6B76' }
                }
              >
                {groupLabel(group)}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-4">
          <span className="text-[11px] tabular-nums text-[#5C5C66]">
            {fmtInt(filteredRows.length)} of {fmtInt(dataset.rows.length)} rows
          </span>
          {/* Same fill as PrimaryButton — the one sanctioned filled control. */}
          <a
            href={datasetCsvUrl()}
            download="leadengine-dataset.csv"
            className="inline-flex shrink-0 items-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-white transition-colors duration-150"
            style={{ backgroundColor: '#5B8DEF' }}
          >
            <Download size={14} strokeWidth={1.75} />
            Download CSV
          </a>
        </div>
      </div>

      {/* Table */}
      {colCount === 0 || dataset.rows.length === 0 ? (
        <EmptyState>
          The dataset is empty — no client snapshots have been collected yet.
        </EmptyState>
      ) : filteredRows.length === 0 ? (
        <EmptyState icon={Search}>No rows match “{search}”.</EmptyState>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-[560px] overflow-auto rounded-[12px] border border-[#1C1C21]"
        >
          <table
            className="w-full text-[12px]"
            style={{ borderCollapse: 'separate', borderSpacing: 0 }}
          >
            <thead>
              {/* Group header row */}
              <tr>
                {groupSpans.map((span, i) => (
                  <th
                    key={`${span.group}-${i}`}
                    colSpan={span.span}
                    scope="colgroup"
                    className={`sticky top-0 px-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${
                      i === 0 ? 'left-0 z-30' : 'z-20'
                    }`}
                    style={{
                      height: GROUP_ROW_H,
                      backgroundColor: '#0E0E11',
                      borderBottom: '1px solid #1C1C21',
                      borderRight: i < groupSpans.length - 1 ? '1px solid #1C1C21' : undefined,
                    }}
                  >
                    {groupLabel(span.group)}
                  </th>
                ))}
              </tr>
              {/* Column label row */}
              <tr>
                {visibleColumns.map((col, i) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={`sticky whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${
                      i === 0 ? 'left-0 z-30 text-left' : 'z-20 text-right'
                    }`}
                    style={{
                      top: GROUP_ROW_H,
                      height: LABEL_ROW_H,
                      backgroundColor: '#0B0B0D',
                      borderBottom: '1px solid #1C1C21',
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const key = rowKey(row, index)
                const isOpen = expanded === key
                const companyId = rowCompanyId(row)
                return (
                  <FragmentRow
                    key={key}
                    row={row}
                    isOpen={isOpen}
                    columns={columns}
                    visibleColumns={visibleColumns}
                    colCount={colCount}
                    companyId={companyId}
                    onToggle={() => setExpanded(isOpen ? null : key)}
                    onOpenClient={() => companyId && navigate(`/clients/${companyId}`)}
                    onCollect={() => companyId && collect.mutate(companyId)}
                    collecting={collect.isPending && collect.variables === companyId}
                  />
                )
              })}
            </tbody>
          </table>

          {visibleCount < filteredRows.length && (
            <div className="px-3 py-3 text-center text-[11px] text-[#5C5C66]">
              Showing {fmtInt(rows.length)} of {fmtInt(filteredRows.length)} — scroll for more
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One data row plus its expandable detail panel. */
function FragmentRow({
  row,
  columns,
  visibleColumns,
  colCount,
  isOpen,
  companyId,
  onToggle,
  onOpenClient,
  onCollect,
  collecting,
}: {
  row: DatasetRow
  columns: DatasetColumn[]
  visibleColumns: DatasetColumn[]
  colCount: number
  isOpen: boolean
  companyId: string | null
  onToggle: () => void
  onOpenClient: () => void
  onCollect: () => void
  collecting: boolean
}) {
  return (
    <>
      <tr
        data-clickable="true"
        onClick={onToggle}
        className="row cursor-pointer"
        aria-expanded={isOpen}
      >
        {visibleColumns.map((col, i) => {
          const value = row[col.key]
          const numeric = typeof value === 'number'
          const text = formatCell(value)
          const isKind = KIND_KEY.test(col.key) && typeof value === 'string' && value !== ''
          const isDelta = DELTA_KEY.test(col.key) && numeric
          let content: ReactNode = text
          if (isKind) {
            content = <Badge color={KIND_TONE[value.toLowerCase()] ?? '#8A8A93'}>{value}</Badge>
          } else if (isDelta) {
            const v = value as number
            content = (
              <span style={{ color: v > 0 ? '#A78BFA' : v < 0 ? '#F06A6A' : undefined }}>
                {formatDelta(v)}
              </span>
            )
          } else if (typeof value === 'string' && (CLAMP_KEY.test(col.key) || text.length > 40)) {
            // Long text: one clamped line in the row, full text in the expander.
            content = (
              <span className="block max-w-[240px] truncate" title={text}>
                {text}
              </span>
            )
          }
          return (
            <td
              key={col.key}
              className={`whitespace-nowrap px-3 py-2.5 ${
                i === 0
                  ? 'sticky left-0 z-10 text-left font-medium text-white'
                  : `text-right ${numeric ? 'tabular-nums' : ''} text-[#8A8A93]`
              }`}
              style={{
                borderBottom: '1px solid #131316',
                backgroundColor: i === 0 ? (isOpen ? '#101014' : '#0B0B0D') : undefined,
              }}
              title={i === 0 && typeof value === 'string' ? text : undefined}
            >
              {content}
            </td>
          )
        })}
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={colCount} style={{ borderBottom: '1px solid #131316' }}>
            <div className="px-4 py-4" style={{ backgroundColor: '#08080A' }}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                {companyId && (
                  <>
                    <button
                      type="button"
                      onClick={onOpenClient}
                      className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-medium text-[#C9C9D1] transition-colors duration-150 hover:text-white"
                      style={{ border: '1px solid #1C1C21' }}
                    >
                      Open client
                      <ArrowUpRight size={13} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={onCollect}
                      disabled={collecting}
                      className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-medium text-[#C9C9D1] transition-colors duration-150 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ border: '1px solid #1C1C21' }}
                    >
                      <RefreshCw
                        size={13}
                        strokeWidth={1.75}
                        className={collecting ? 'animate-spin' : undefined}
                      />
                      {collecting ? 'Collecting…' : 'Collect fresh snapshot'}
                    </button>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 md:grid-cols-3 lg:grid-cols-4">
                {columns.map((col) => (
                  <div key={col.key} className="flex items-baseline justify-between gap-3">
                    <span className="shrink-0 truncate text-[11px] text-[#5C5C66]" title={col.label}>
                      {col.label}
                    </span>
                    <span className="min-w-0 break-words text-right text-[12px] tabular-nums text-[#C9C9D1]">
                      {formatCell(row[col.key])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
