import { useMemo } from 'react'
import type { CitationDomain } from '@/lib/api'
import { Badge } from '@/components/primitives/Badge'
import { CHART } from '@/components/primitives/chartTheme'

/**
 * CompetitorTeardown — per-competitor analysis of *which domains power their
 * AI visibility*. For every competitor we list the domains that co-occur with
 * their brand in AI answers, ranked by citation volume. Domains where the
 * company has zero citations are flagged as opportunities.
 */
export function CompetitorTeardown({
  domains,
  competitors,
  limit = 4,
}: {
  domains: CitationDomain[]
  /** Competitor names to tear down; extra names found in the data are appended. */
  competitors: string[]
  /** Max domains listed per competitor. */
  limit?: number
}) {
  // Build "competitor -> domains citing them" from the supply chain data.
  const teardowns = useMemo(() => {
    // Union of configured competitors and names discovered in citation data.
    const names = new Set<string>(competitors)
    for (const d of domains) {
      for (const c of d.competitors ?? []) names.add(c)
    }

    return [...names]
      .map((name) => {
        const feeding = domains
          .filter((d) => (d.competitors ?? []).includes(name))
          .sort((a, b) => b.competitorCitations - a.competitorCitations)
        return {
          name,
          domains: feeding,
          totalCitations: feeding.reduce((n, d) => n + d.competitorCitations, 0),
          opportunities: feeding.filter((d) => d.companyCitations === 0).length,
        }
      })
      .filter((t) => t.domains.length > 0)
      .sort((a, b) => b.totalCitations - a.totalCitations)
  }, [domains, competitors])

  if (teardowns.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[#5C5C66]">
        No competitor citation data yet — teardown appears once competitors are cited by AI answers.
      </div>
    )
  }

  const maxTotal = Math.max(...teardowns.map((t) => t.totalCitations), 1)

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {teardowns.map((t) => (
        <div
          key={t.name}
          className="rounded-[10px] border border-[#16161A] bg-[#0E0E11] p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-[#C9C9D1]" title={t.name}>
                {t.name}
              </div>
              <div className="mt-0.5 text-[12px] text-[#5C5C66]">
                cited on {t.domains.length} domain{t.domains.length === 1 ? '' : 's'}
              </div>
            </div>
            {t.opportunities > 0 && (
              <Badge color="#E8A04C">
                {t.opportunities} open {t.opportunities === 1 ? 'domain' : 'domains'}
              </Badge>
            )}
          </div>

          {/* Relative citation share bar */}
          <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-[#16161A]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((t.totalCitations / maxTotal) * 100, 3)}%`,
                backgroundColor: CHART.line,
              }}
            />
          </div>

          {/* Winning pages for this competitor */}
          <div className="mt-4 flex flex-col">
            {t.domains.slice(0, limit).map((d) => (
              <div
                key={d.domain}
                className="row -mx-2 flex items-center justify-between gap-3 px-2 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <DomainFavicon domain={d.domain} />
                  <span className="truncate text-[13px] text-[#8A8A93]" title={d.domain}>
                    {d.domain}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] tabular-nums text-[#5C5C66]">
                    {d.competitorCitations} cites
                  </span>
                  {d.companyCitations === 0 ? (
                    <Badge color="#E8A04C">gap</Badge>
                  ) : (
                    <Badge color="#A78BFA">shared</Badge>
                  )}
                </span>
              </div>
            ))}
            {t.domains.length > limit && (
              <div className="mt-1.5 text-[12px] text-[#5C5C66]">
                +{t.domains.length - limit} more domains
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Domain favicon via Google's public favicon service, with a graceful
 * fallback when the icon cannot be loaded (offline, unknown domain).
 */
export function DomainFavicon({ domain }: { domain: string }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={(e) => {
        // Replace the broken image with a neutral dot.
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}
