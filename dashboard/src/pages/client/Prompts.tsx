import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { getClientPrompts, type ClientPromptItem } from '@/lib/api'
import { Card } from '@/components/primitives/Card'
import { StatBox } from '@/components/primitives/StatBox'
import { Badge } from '@/components/primitives/Badge'
import { OutlineButton } from '@/components/primitives/Button'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'

const MAX_ROWS = 150

/** Persona identity: Avatar = purple (the signature accent), General = grey-blue. */
const PERSONA_COLORS: Record<string, string> = { general: '#7C9BD4', avatar: '#A78BFA' }
const SCOPE_COLORS: Record<string, string> = { regional: '#5B8DEF', dach: '#E8A04C' }
const TIER_COLOR = '#8A8A93'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d, yyyy HH:mm')
}

/** One filter dimension rendered as a chip row ("All" + one chip per value). */
function ChipFilter({
  label,
  values,
  active,
  onChange,
  colorOf,
}: {
  label: string
  values: string[]
  active: string
  onChange: (v: string) => void
  colorOf?: (v: string) => string
}) {
  if (values.length === 0) return null
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={`${label} filter`}>
      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
        {label}
      </span>
      {['all', ...values].map((v) => {
        const isActive = active === v
        const tint = v !== 'all' && colorOf ? colorOf(v) : '#A78BFA'
        return (
          <button
            key={v}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(v)}
            className="rounded-[4px] px-2 py-[5px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em] transition-colors duration-150"
            style={
              isActive
                ? { backgroundColor: `${tint}1F`, color: tint }
                : { backgroundColor: '#8A8A9314', color: '#8A8A93' }
            }
          >
            {v === 'all' ? 'All' : v}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Prompts tab — the client's auto-refreshing prompt library. Sticky filter
 * bar (persona / scope / tier chips + search) over a clean prompt list.
 */
export function Prompts() {
  const { id: companyId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [persona, setPersona] = useState('all')
  const [scope, setScope] = useState('all')
  const [tier, setTier] = useState('all')

  const promptsQuery = useQuery({
    queryKey: ['client-prompts', companyId],
    queryFn: () => getClientPrompts(companyId!),
    enabled: Boolean(companyId),
  })
  const data = promptsQuery.data
  const prompts = useMemo(() => data?.prompts ?? [], [data])

  /** Manual refresh: server-side refresh run, then re-fetch the library. */
  async function refreshNow() {
    if (!companyId || refreshing) return
    setRefreshing(true)
    try {
      await getClientPrompts(companyId, true)
      await queryClient.invalidateQueries({ queryKey: ['client-prompts', companyId] })
      toast.success('Prompt library refreshed')
    } catch (err) {
      // A silent failure looked identical to a no-op refresh — say so.
      toast.error(err instanceof Error ? err.message : 'Prompt refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const { personas, scopes, tiers } = useMemo(() => {
    const distinct = (pick: (p: ClientPromptItem) => string) =>
      Array.from(new Set(prompts.map(pick).filter(Boolean))).sort()
    return {
      personas: distinct((p) => p.persona),
      scopes: distinct((p) => p.scope),
      tiers: distinct((p) => p.tier),
    }
  }, [prompts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return prompts
      .filter((p) => (persona === 'all' ? true : p.persona === persona))
      .filter((p) => (scope === 'all' ? true : p.scope === scope))
      .filter((p) => (tier === 'all' ? true : p.tier === tier))
      .filter((p) => (q ? p.text.toLowerCase().includes(q) : true))
  }, [prompts, persona, scope, tier, search])

  const avatarCount = prompts.filter((p) => p.persona === 'avatar').length
  const filtersActive = persona !== 'all' || scope !== 'all' || tier !== 'all' || search.trim() !== ''
  const visible = filtered.slice(0, MAX_ROWS)

  return (
    <div className="flex flex-col gap-5">
      {/* Count summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatBox label="Total prompts" value={String(data?.total ?? 0)} />
        <StatBox
          label="Avatar prompts"
          value={String(avatarCount)}
          delta={prompts.length > 0 ? `${prompts.length - avatarCount} general` : undefined}
          tone="green"
        />
        <StatBox label="Library version" value={data && data.version > 0 ? `v${data.version}` : '—'} />
        <StatBox label="Last updated" value={fmtDate(data?.updatedAt ?? null)} />
      </div>

      <Card
        title="Prompt Library"
        meta={
          filtersActive
            ? `${filtered.length} of ${prompts.length} prompts`
            : 'niche-specific buyer prompts, refreshed every 3 days'
        }
        right={
          <OutlineButton onClick={refreshNow} disabled={refreshing || promptsQuery.isLoading}>
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </OutlineButton>
        }
      >
        {promptsQuery.isLoading ? (
          <PanelSkeleton lines={4} className="h-48" />
        ) : prompts.length === 0 ? (
          <EmptyState>
            No prompt library yet. It is generated during the first audit — or hit Refresh now.
          </EmptyState>
        ) : (
          <div>
            {/* Sticky filter bar */}
            <div className="sticky top-0 z-10 -mx-3 mb-2 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-[#131316] bg-[#0B0B0D] px-3 pb-3.5 pt-1">
              <div className="relative w-full max-w-[260px]">
                <Search
                  size={14}
                  strokeWidth={1.5}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C5C66]"
                />
                <input
                  className="w-full rounded-[10px] border border-[#16161A] bg-[#0E0E11] py-2 pl-9 pr-3 text-[13px] text-white outline-none transition-colors duration-150 placeholder:text-[#5C5C66] focus:border-[#33333C]"
                  placeholder="Search prompts…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search prompts"
                />
              </div>
              <ChipFilter
                label="Persona"
                values={personas}
                active={persona}
                onChange={setPersona}
                colorOf={(v) => PERSONA_COLORS[v] ?? '#8A8A93'}
              />
              <ChipFilter
                label="Scope"
                values={scopes}
                active={scope}
                onChange={setScope}
                colorOf={(v) => SCOPE_COLORS[v] ?? '#8A8A93'}
              />
              <ChipFilter label="Tier" values={tiers} active={tier} onChange={setTier} />
            </div>

            {filtered.length === 0 ? (
              <div className="flex h-[140px] items-center justify-center text-[13px] text-[#5C5C66]">
                No prompts match the current filters.
              </div>
            ) : (
              <div className="flex flex-col">
                {visible.map((p, i) => (
                  <div
                    key={`${i}-${p.text}`}
                    className="row -mx-2 flex items-center gap-3 border-b border-[#131316] px-2 py-2 last:border-0"
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PERSONA_COLORS[p.persona] ?? '#5C5C66' }}
                    />
                    <span
                      className="min-w-0 truncate text-[13px] leading-relaxed text-[#C9C9D1]"
                      title={p.text}
                    >
                      {p.text}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <Badge color={PERSONA_COLORS[p.persona] ?? '#8A8A93'}>{p.persona}</Badge>
                      <Badge color={SCOPE_COLORS[p.scope] ?? '#8A8A93'}>{p.scope}</Badge>
                      <Badge color={TIER_COLOR}>{p.tier}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {filtered.length > MAX_ROWS && (
              <div className="pt-3 text-[12px] text-[#5C5C66]">
                +{filtered.length - MAX_ROWS} more prompts — narrow with search or filters
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
