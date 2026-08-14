import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Search } from 'lucide-react'
import {
  getCitations,
  getCompany,
  getSupplyChain,
  mergeSupplyChain,
  type CitationDomain,
  type CitationSupplyChain,
} from '@/lib/api'
import { Card } from '@/components/primitives/Card'
import { Badge } from '@/components/primitives/Badge'
import { Tabs } from '@/components/primitives/Tabs'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { CitationSupplyChainGraph } from '@/components/CitationSupplyChainGraph'
import { DomainFavicon } from '@/components/CompetitorTeardown'

function isOpportunity(d: CitationDomain): boolean {
  return d.companyCitations === 0 && d.competitorCitations > 0
}

/** Hard cap on rendered rows (search narrows beyond this). */
const MAX_TABLE_ROWS = 100

type DomainTab = 'all' | 'opportunities'

// ---------- Domain classification ----------

type DomainClass = 'own' | 'directory' | 'earned' | 'other'

/** Distinct tint per class (paired with the badge label — never color alone). */
const CLASS_TINT: Record<DomainClass, string> = {
  own: '#A78BFA',
  directory: '#5B8DEF',
  earned: '#E8A04C',
  other: '#5C5C66',
}

const CLASS_LABEL: Record<DomainClass, string> = {
  own: 'Own',
  directory: 'Directory',
  earned: 'Earned',
  other: 'Other',
}

/** Well-known listing/review directories (CH/DACH heavy, plus globals). */
const DIRECTORY_DOMAINS = [
  'local.ch',
  'search.ch',
  'gelbeseiten',
  'moneyhouse.ch',
  'kompass.com',
  'wlw.ch',
  'wlw.de',
  'europages',
  'yelp.',
  'clutch.co',
  'sortlist',
  'trustpilot',
  'provenexpert',
  'kununu',
  'g2.com',
  'capterra',
  'goodfirms',
  'designrush',
  'semrush.com/agencies',
  'agenturmatching',
  'firmenabc',
  'cylex',
  'yellowpages',
  'crunchbase.com',
]

function isDirectoryDomain(domain: string): boolean {
  const d = domain.toLowerCase()
  return (
    DIRECTORY_DOMAINS.some((frag) => d.includes(frag)) ||
    /verzeichnis|directory|firmen(index|liste)/.test(d)
  )
}

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Classify a cited domain: your own web estate, a listing directory, earned
 * third-party coverage (you are cited there), or other (no citations for you
 * yet — including pure competitor territory).
 */
function classify(
  d: CitationDomain,
  ownDomains: Set<string>,
  companyHost: string | null,
): DomainClass {
  const dom = d.domain.toLowerCase().replace(/^www\./, '')
  if (ownDomains.has(dom) || (companyHost !== null && (dom === companyHost || dom.endsWith(`.${companyHost}`))))
    return 'own'
  if (isDirectoryDomain(dom)) return 'directory'
  if (d.companyCitations > 0) return 'earned'
  return 'other'
}

function ownDomainsOf(chain: CitationSupplyChain | null): Set<string> {
  const set = new Set<string>()
  for (const d of chain?.domains ?? []) {
    if (d.isOwn) set.add(d.domain.toLowerCase().replace(/^www\./, ''))
  }
  return set
}

// ---------- Page ----------

export function Citations() {
  // Scoped to the client route — the client detail shell owns the header.
  const { id: companyId } = useParams<{ id: string }>()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<DomainTab>('all')

  const companyQuery = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => getCompany(companyId!),
    enabled: Boolean(companyId),
  })

  const citationsQuery = useQuery({
    queryKey: ['citations', companyId],
    queryFn: () => getCitations(companyId!),
    enabled: Boolean(companyId),
  })
  const supplyChainQuery = useQuery({
    queryKey: ['supply-chain', companyId],
    queryFn: () => getSupplyChain(companyId!),
    enabled: Boolean(companyId),
  })

  const selectedCompanyName = companyQuery.data?.company.name
  const companyHost = hostnameOf(companyQuery.data?.company.website)

  // Merge supply-chain competitor attribution into the citation sources so
  // the table and the chart can show *which* competitor each domain feeds.
  const enriched = useMemo<CitationDomain[]>(
    () => mergeSupplyChain(citationsQuery.data ?? [], supplyChainQuery.data ?? null),
    [citationsQuery.data, supplyChainQuery.data],
  )
  const ownDomains = useMemo(
    () => ownDomainsOf(supplyChainQuery.data ?? null),
    [supplyChainQuery.data],
  )

  const ranked = useMemo(
    () =>
      [...enriched].sort(
        (a, b) =>
          b.companyCitations + b.competitorCitations - (a.companyCitations + a.competitorCitations),
      ),
    [enriched],
  )

  // Compact summary strip numbers.
  const summary = useMemo(() => {
    const total = ranked.reduce((n, d) => n + d.companyCitations + d.competitorCitations, 0)
    const own = ranked.reduce((n, d) => n + d.companyCitations, 0)
    const top = ranked[0]
    return {
      total,
      ownShare: total > 0 ? own / total : null,
      topDomain: top?.domain ?? null,
      topCites: top ? top.companyCitations + top.competitorCitations : 0,
    }
  }, [ranked])

  const domains = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? ranked.filter((d) => d.domain.toLowerCase().includes(q)) : ranked
  }, [ranked, search])

  const opportunities = useMemo(() => domains.filter(isOpportunity), [domains])
  const visible = tab === 'all' ? domains : opportunities

  return (
    <div className="flex flex-col gap-5">
      {/* Compact summary strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCell label="Total citations" value={String(summary.total)} />
        <SummaryCell
          label="Own share"
          value={summary.ownShare === null ? '—' : `${(summary.ownShare * 100).toFixed(2)}%`}
          tone={summary.ownShare !== null && summary.ownShare > 0 ? '#A78BFA' : '#8A8A93'}
        />
        <SummaryCell
          label="Top domain"
          value={summary.topDomain ?? '—'}
          sub={summary.topDomain ? `${summary.topCites} citations` : undefined}
        />
      </div>

      {/* Supply chain: domains ranked by citation volume */}
      <Card
        title="Citation Supply Chain"
        meta={
          opportunities.length > 0
            ? `${opportunities.length} opportunity ${opportunities.length === 1 ? 'domain' : 'domains'}`
            : 'domains ranked by citations'
        }
      >
        {citationsQuery.isLoading || supplyChainQuery.isLoading ? (
          <PanelSkeleton lines={5} className="h-64" />
        ) : (
          <CitationSupplyChainGraph
            domains={enriched}
            companyName={selectedCompanyName ?? 'You'}
          />
        )}
      </Card>

      {/* Ranked domain table */}
      <Card
        title="Domains"
        meta={`${visible.length} shown`}
        right={
          <Tabs
            options={[
              { value: 'all', label: `All Domains (${domains.length})` },
              { value: 'opportunities', label: `Opportunities (${opportunities.length})` },
            ]}
            value={tab}
            onChange={setTab}
            ariaLabel="Domain filter"
          />
        }
      >
        <div className="relative mb-4 max-w-sm">
          <Search
            size={14}
            strokeWidth={1.5}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C5C66]"
          />
          <input
            className="w-full rounded-[10px] border border-[#16161A] bg-[#0E0E11] py-2 pl-9 pr-3 text-[13px] text-white outline-none transition-colors duration-150 placeholder:text-[#5C5C66] focus:border-[#33333C]"
            placeholder="Filter by domain…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {citationsQuery.isLoading ? (
          <PanelSkeleton lines={4} className="h-40" />
        ) : visible.length === 0 ? (
          <EmptyState>
            {tab === 'opportunities'
              ? 'No opportunity domains found — competitors are not cited anywhere you are absent.'
              : 'No citation data yet.'}
          </EmptyState>
        ) : (
          <DomainRows domains={visible} ownDomains={ownDomains} companyHost={companyHost} />
        )}
      </Card>
    </div>
  )
}

/** One inset stat cell of the summary strip. */
function SummaryCell({
  label,
  value,
  sub,
  tone = '#FFFFFF',
}: {
  label: string
  value: string
  sub?: string
  tone?: string
}) {
  return (
    <div className="rounded-[12px] border border-[#1C1C21] bg-[#0B0B0D] px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
        {label}
      </div>
      <div
        className="mt-2.5 truncate text-[20px] font-medium tabular-nums"
        style={{ color: tone }}
        title={value}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] tabular-nums text-[#5C5C66]">{sub}</div>}
    </div>
  )
}

function DomainRows({
  domains,
  ownDomains,
  companyHost,
}: {
  domains: CitationDomain[]
  ownDomains: Set<string>
  companyHost: string | null
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // Cap rendering — large companies can have hundreds of cited domains;
  // the search box is the way to find anything beyond the top slice.
  const visible = domains.slice(0, MAX_TABLE_ROWS)
  const hidden = domains.length - visible.length
  const maxCites = Math.max(
    1,
    ...domains.map((d) => d.companyCitations + d.competitorCitations),
  )

  return (
    <div>
      {/* Header */}
      <div className="grid grid-cols-[18px_minmax(0,3fr)_minmax(0,2.4fr)_64px_96px_96px] items-center gap-3 border-b border-[#131316] px-3 py-2.5">
        <span aria-hidden />
        {['Domain', 'Citation volume', 'Cites', 'Class', 'Status'].map((h, i) => (
          <div
            key={h}
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76] ${i === 2 ? 'text-right' : ''}`}
          >
            {h}
          </div>
        ))}
      </div>

      {visible.map((d) => {
        const cls = classify(d, ownDomains, companyHost)
        const total = d.companyCitations + d.competitorCitations
        const opportunity = isOpportunity(d)
        const open = expanded === d.domain
        return (
          <div key={d.domain} className="border-b border-[#131316] last:border-0">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : d.domain)}
              className="row grid w-full grid-cols-[18px_minmax(0,3fr)_minmax(0,2.4fr)_64px_96px_96px] items-center gap-3 px-3 py-2.5 text-left"
            >
              <ChevronDown
                size={13}
                strokeWidth={1.5}
                aria-hidden
                className={`shrink-0 text-[#5C5C66] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
              />
              <div className="flex min-w-0 items-center gap-2.5">
                <DomainFavicon domain={d.domain} />
                <span className="truncate text-[13px] text-[#C9C9D1]" title={d.domain}>
                  {d.domain}
                </span>
              </div>
              {/* Proportional citation bar */}
              <div className="flex items-center">
                <div
                  className="h-[6px] w-full overflow-hidden rounded-full bg-[#16161A]"
                  role="img"
                  aria-label={`${total} citations of ${maxCites} max`}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-200"
                    style={{
                      width: `${Math.max(total > 0 ? 3 : 0, (total / maxCites) * 100)}%`,
                      backgroundColor: CLASS_TINT[cls],
                    }}
                  />
                </div>
              </div>
              <div className="text-right text-[12px] tabular-nums text-[#8A8A93]">{total}</div>
              <div>
                <Badge color={CLASS_TINT[cls]}>{CLASS_LABEL[cls]}</Badge>
              </div>
              <div>
                {opportunity ? (
                  <Badge color="#E8A04C">Opportunity</Badge>
                ) : d.companyCitations > 0 ? (
                  <Badge color="#A78BFA">Covered</Badge>
                ) : (
                  <Badge color="#8A8A93">Inactive</Badge>
                )}
              </div>
            </button>

            {/* Expanded detail: prompt types, split, cited competitors */}
            {open && (
              <div className="mx-3 mb-3 rounded-[10px] border border-[#16161A] bg-[#0E0E11] px-4 py-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                      Prompt types
                    </div>
                    {d.promptTypes && d.promptTypes.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {d.promptTypes.map((t) => (
                          <Badge key={t} color="#8A8A93">{t}</Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1.5 text-[12px] text-[#3F3F47]">
                        No prompt types recorded
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                      Citation split
                    </div>
                    <div className="mt-1.5 text-[12px] tabular-nums text-[#8A8A93]">
                      You <span className="text-white">{d.companyCitations}</span>
                      {' · '}
                      Competitors <span className="text-white">{d.competitorCitations}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                      Cited competitors
                    </div>
                    <div
                      className="mt-1.5 truncate text-[12px] text-[#8A8A93]"
                      title={(d.competitors ?? []).join(', ')}
                    >
                      {d.competitors && d.competitors.length > 0 ? d.competitors.join(', ') : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {hidden > 0 && (
        <div className="pt-3 text-center text-[12px] text-[#5C5C66]">
          +{hidden} more domains — use the search box to filter
        </div>
      )}
    </div>
  )
}
