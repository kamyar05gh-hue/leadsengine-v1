import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import {
  API_HOST,
  ApiError,
  cancelJob,
  createAudit,
  getAudit,
  getCompanyFiles,
  getJobEvents,
  getReportPdfUrl,
  lookupCompany,
  retryJob,
  fileUrl,
  type Audit,
  type CompanyFiles,
  type EngineId,
  type RunScope,
  type JobEvent,
} from '@/lib/api'
import { Select, type SelectOption } from '@/components/primitives/Select'
import { NumberField } from '@/components/primitives/NumberField'
import { fmtClock, fmtUsd } from '@/lib/format'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Card } from '@/components/primitives/Card'
import { PrimaryButton, OutlineButton } from '@/components/primitives/Button'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { TickSet } from '@/components/TickSet'
import { AuditTimeline } from '@/components/AuditTimeline'
import { PipelineStepper } from '@/components/PipelineStepper'

const ENGINE_OPTIONS: { value: EngineId; label: string }[] = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
  { value: 'perplexity', label: 'Perplexity' },
]

/** "Focused" allocation preset: broad engines deep, niche engines light. */
const FOCUSED_PRESET: Record<EngineId, number> = {
  chatgpt: 20,
  gemini: 20,
  perplexity: 10,
  claude: 10,
}

/** Rough blended average across engine vendors, for the live estimate only. */
const EST_USD_PER_CALL = 0.02

const LOCATION_OPTIONS = [
  { value: 'Zürich', label: 'Zürich' },
  { value: 'Genf', label: 'Genf' },
  { value: 'Basel', label: 'Basel' },
  { value: 'Bern', label: 'Bern' },
  { value: 'Lausanne', label: 'Lausanne' },
  { value: 'Luzern', label: 'Luzern' },
  { value: 'St. Gallen', label: 'St. Gallen' },
  { value: 'Winterthur', label: 'Winterthur' },
  { value: 'Schweiz', label: 'Schweiz (national)' },
  { value: 'DACH', label: 'DACH' },
]

/**
 * Industry / sector is a choice, not free text — these are the niches the
 * pipeline is tuned for. "Other…" reveals a free-text input so an unusual
 * sector (or one the company lookup returns) is still expressible; either
 * way the submitted `industry` stays a plain string.
 */
const SECTOR_OPTIONS = [
  'Marketingagentur',
  'Social Media Marketing',
  'Webagentur',
  'Treuhand',
  'Anwaltskanzlei',
  'Arztpraxis',
  'Zahnarztpraxis',
  'Handwerk/Bau',
  'Immobilien',
  'IT-Dienstleistung',
  'Restaurant/Gastro',
  'Fitness/Gesundheit',
]

/**
 * Run depth. Each scope is a PREFIX of the same stage chain — a shorter run
 * is the identical pipeline stopping earlier, never a reduced analysis.
 */
const RUN_SCOPE_OPTIONS: { value: RunScope; label: string; detail: string }[] = [
  {
    value: 'report',
    label: 'Report',
    detail: 'Measure all engines, score visibility, competitor teardowns — through the PDF report.',
  },
  {
    value: 'actions',
    label: 'Action plan',
    detail: 'Everything in Report, plus the prioritised action plan and its PDFs.',
  },
  {
    value: 'full',
    label: 'Full workflow',
    detail: 'Everything above, plus the AI crawl pack: landing pages, JSON-LD, FAQ, sitemap.',
  },
]

const SECTOR_OTHER = '__other__'

const SECTOR_SELECT_OPTIONS: SelectOption[] = [
  ...SECTOR_OPTIONS.map((s) => ({ value: s, label: s })),
  { value: SECTOR_OTHER, label: 'Other…' },
]

const inputClass =
  'w-full rounded-[10px] border border-[#16161A] bg-[#0E0E11] px-3 py-2.5 text-[13px] text-white outline-none transition-colors duration-150 placeholder:text-[#5C5C66] focus:border-[#33333C]'
const labelClass =
  'text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]'

function engineLabel(id: string): string {
  return ENGINE_OPTIONS.find((o) => o.value === id)?.label ?? id
}

/** Valid-ish website check for triggering the lookup (not for validation). */
function looksLikeUrl(value: string): boolean {
  return value.length > 4 && value.includes('.') && !value.includes(' ')
}

/** Ticking seconds elapsed since `createdAt`; freezes when `running` is false. */
function useElapsedSeconds(createdAt: string | undefined, running: boolean): number {
  const startMs = createdAt ? new Date(createdAt).getTime() : null
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (startMs === null) return
    const update = () => setElapsed(Math.max(0, (Date.now() - startMs) / 1000))
    update()
    if (!running) return
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startMs, running])
  return elapsed
}

/** Summary line for a finished audit. Mounts only on `completed`, so the
 *  duration is captured once in the state initializer. */
function CompletedSummary({ audit }: { audit: Audit }) {
  const [elapsed] = useState(() => (Date.now() - new Date(audit.createdAt).getTime()) / 1000)
  return (
    <div className="mt-5 text-[12px] tabular-nums text-[#8A8A93]">
      Completed in {fmtClock(elapsed)}
      {audit.spend && (
        <>
          {' '}
          · {fmtUsd(audit.spend.estimatedUsd)} estimated · {audit.spend.calls} API calls
        </>
      )}
    </div>
  )
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[ä]/g, 'ae')
    .replace(/[ö]/g, 'oe')
    .replace(/[ü]/g, 'ue')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Per-location deliverables card shown once the audit completes. */
function GeneratedFilesCard({ companyId, locations }: { companyId: string; locations?: string[] }) {
  const filesQuery = useQuery<CompanyFiles>({
    queryKey: ['company-files', companyId],
    queryFn: () => getCompanyFiles(companyId),
    enabled: !!companyId,
  })

  if (filesQuery.isLoading) {
    return (
      <Card title="Generated files" meta="per location">
        <PanelSkeleton lines={3} className="h-24" />
      </Card>
    )
  }
  if (filesQuery.isError || !filesQuery.data) {
    return (
      <Card title="Generated files" meta="per location">
        <p className="text-[13px] text-[#F06A6A]">Could not load generated files.</p>
      </Card>
    )
  }

  const { reports, landingPages } = filesQuery.data.categories
  const locs = locations ?? []

  const rows = locs.map((loc) => {
    const slug = slugify(loc)
    const repDe = reports.find((r) => r.lang === 'de' && r.name.toLowerCase().includes(slug))
    const repEn = reports.find((r) => r.lang === 'en' && r.name.toLowerCase().includes(slug))
    return { loc, repDe, repEn }
  })

  const baseReports = reports.filter((r) => !locs.some((loc) => r.name.toLowerCase().includes(slugify(loc))))
  const basePages = landingPages.filter((p) => !locs.some((loc) => p.name.toLowerCase().includes(slugify(loc))))

  const FileLink = ({ f, label }: { f?: { url: string; name: string }; label: string }) => (
    f ? (
      <a href={fileUrl(f.url)} target="_blank" rel="noreferrer" className="text-[12px] text-[#5B8DEF] transition-colors duration-150 hover:text-white">
        {label}
      </a>
    ) : (
      <span className="text-[12px] text-[#3F3F47]">{label}</span>
    )
  )

  return (
    <Card title="Generated files" meta="per location">
      <div className="flex flex-col gap-4">
        {rows.map(({ loc, repDe, repEn }) => (
          <div key={loc} className="rounded-[10px] border border-[#16161A] bg-[#0E0E11] p-4">
            <div className="text-[13px] font-medium text-white">{loc}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-[#8A8A93]">
              <div>Report DE: <FileLink f={repDe} label="Open" /></div>
              <div>Report EN: <FileLink f={repEn} label="Open" /></div>
            </div>
          </div>
        ))}
        {(baseReports.length > 0 || basePages.length > 0) && (
          <div className="rounded-[10px] border border-[#16161A] bg-[#0E0E11] p-4">
            <div className="text-[13px] font-medium text-white">Base reports & GEO landing pages</div>
            <div className="mt-2 flex flex-col gap-1">
              {baseReports.map((r) => (
                <a key={r.id} href={fileUrl(r.url)} target="_blank" rel="noreferrer" className="text-[12px] text-[#5B8DEF] transition-colors duration-150 hover:text-white">
                  {r.name} ({r.lang})
                </a>
              ))}
              {basePages.map((p) => (
                <a key={p.id} href={fileUrl(p.url)} target="_blank" rel="noreferrer" className="text-[12px] text-[#5B8DEF] transition-colors duration-150 hover:text-white">
                  {p.name}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Live pipeline log, newest first. Monospaced timestamps, stage tag,
 * message. Sticks to the top (where the newest lines land) unless the
 * user has scrolled down into history.
 */
function LiveActivityFeed({ events, live }: { events: JobEvent[]; live: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const newestFirst = [...events].reverse()

  useEffect(() => {
    const el = containerRef.current
    // Newest lines render at the top; follow them unless the user scrolled away.
    if (el && el.scrollTop < 40) el.scrollTop = 0
  }, [events.length])

  if (newestFirst.length === 0) {
    return <p className="text-[13px] text-[#5C5C66]">Waiting for pipeline events…</p>
  }

  return (
    <div ref={containerRef} className="max-h-[360px] overflow-y-auto pr-1">
      {newestFirst.map((event, i) => (
        <div
          key={`${event.at}-${i}`}
          className={`flex items-baseline gap-2.5 py-1.5 ${i > 0 ? 'border-t border-[#131316]' : ''}`}
        >
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#5C5C66]">
            {new Date(event.at).toLocaleTimeString('en-GB', { hour12: false })}
          </span>
          <span className="w-[72px] shrink-0 truncate text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#6B6B76]">
            {event.stage}
          </span>
          <span className="min-w-0 break-words text-[12px] leading-relaxed text-[#8A8A93]">
            {event.message}
          </span>
        </div>
      ))}
      {live && (
        <div className="flex items-center gap-2 border-t border-[#131316] py-1.5 text-[11px] text-[#3F3F47]">
          last {newestFirst.length} events · newest first
        </div>
      )}
    </div>
  )
}

export function Audit() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [companyName, setCompanyName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [industry, setIndustry] = useState('')
  // Which row of the sector dropdown is selected; SECTOR_OTHER reveals the
  // free-text input that then owns `industry`.
  const [sectorChoice, setSectorChoice] = useState('')
  const [avatar, setAvatar] = useState('')
  const [locations, setLocations] = useState<string[]>(['Zürich'])
  const [promptCount, setPromptCount] = useState(50)
  const [engines, setEngines] = useState<EngineId[]>(ENGINE_OPTIONS.map((e) => e.value))
  // Per-engine overrides; an engine without an entry runs `promptCount` prompts.
  const [allocations, setAllocations] = useState<Partial<Record<EngineId, number>>>({})
  const [runScope, setRunScope] = useState<RunScope>('full')
  const [runningAuditId, setRunningAuditId] = useState<string | null>(null)
  const [lookupPending, setLookupPending] = useState(false)
  const [lookupDescription, setLookupDescription] = useState<string | null>(null)
  const industryTouched = useRef(false)

  const allocationFor = (engine: EngineId): number => allocations[engine] ?? promptCount
  const totalCalls = engines.reduce((sum, e) => sum + allocationFor(e), 0)
  const estCostUsd = totalCalls * EST_USD_PER_CALL

  const createMutation = useMutation({
    mutationFn: createAudit,
    onSuccess: (audit) => {
      queryClient.invalidateQueries({ queryKey: ['audits'] })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      if (audit.status === 'completed') {
        navigate(`/clients/${audit.companyId}`)
      } else {
        setRunningAuditId(audit.id)
      }
    },
  })

  // Poll the audit while it is pending/running to show live progress.
  const auditQuery = useQuery<Audit>({
    queryKey: ['audit', runningAuditId],
    queryFn: () => getAudit(runningAuditId!),
    enabled: runningAuditId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'completed' || status === 'failed' ? false : 2000
    },
  })

  const runningAudit = auditQuery.data
  const auditStatus = runningAudit?.status ?? 'pending'
  const auditTerminal = auditStatus === 'completed' || auditStatus === 'failed'

  // Live pipeline log — polled on the same 2s cadence as the audit itself.
  const eventsQuery = useQuery({
    queryKey: ['job-events', runningAuditId],
    queryFn: () => getJobEvents(runningAuditId!),
    enabled: runningAuditId !== null,
    refetchInterval: () => (auditTerminal ? false : 2000),
  })

  const retryMutation = useMutation({
    mutationFn: () => retryJob(runningAuditId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit', runningAuditId] })
      queryClient.invalidateQueries({ queryKey: ['job-events', runningAuditId] })
    },
  })

  /**
   * Stop a live run. The backend marks the job failed, so the view flips to
   * the failed state (with Retry) rather than disappearing.
   */
  const cancelMutation = useMutation({
    mutationFn: () => cancelJob(runningAuditId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit', runningAuditId] })
      queryClient.invalidateQueries({ queryKey: ['job-events', runningAuditId] })
      queryClient.invalidateQueries({ queryKey: ['audits'] })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
    },
  })

  const elapsed = useElapsedSeconds(runningAudit?.createdAt, !auditTerminal)

  useEffect(() => {
    if (runningAudit?.status === 'completed' || runningAudit?.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['audits'] })
    }
  }, [runningAudit?.status, queryClient])

  // Quick company lookup: once name + website are filled, debounce and
  // prefill the industry field (unless the user edited it manually).
  // Fully best-effort — any failure is silent.
  useEffect(() => {
    const name = companyName.trim()
    const site = websiteUrl.trim()
    if (name.length < 3 || !looksLikeUrl(site)) {
      setLookupPending(false)
      setLookupDescription(null)
      return
    }
    setLookupPending(true)
    const timer = setTimeout(async () => {
      const result = await lookupCompany(name, site)
      setLookupPending(false)
      if (!result?.ok) return
      if (result.sector && !industryTouched.current) {
        // Snap the lookup's sector onto a known niche when it matches one,
        // otherwise keep it verbatim behind the "Other…" row.
        const match = SECTOR_OPTIONS.find(
          (s) => s.toLowerCase() === result.sector!.trim().toLowerCase(),
        )
        setSectorChoice(match ?? SECTOR_OTHER)
        setIndustry(match ?? result.sector)
      }
      setLookupDescription(result.description ?? null)
    }, 800)
    return () => clearTimeout(timer)
  }, [companyName, websiteUrl])

  const canSubmit =
    companyName.trim() !== '' &&
    websiteUrl.trim() !== '' &&
    // The backend requires industry.min(2) — block the round-trip instead of
    // letting it come back as an opaque 400.
    industry.trim().length >= 2 &&
    locations.length > 0 &&
    engines.length > 0 &&
    promptCount > 0 &&
    totalCalls > 0 &&
    !createMutation.isPending &&
    runningAuditId === null

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    createMutation.mutate({
      companyName: companyName.trim(),
      websiteUrl: websiteUrl.trim(),
      industry: industry.trim(),
      locations,
      region: locations[0], // backward compat
      competitors: [], // backend auto-discovers competitors
      promptCount,
      engines,
      avatar: avatar.trim() || undefined,
      enginePrompts: Object.fromEntries(engines.map((eng) => [eng, allocationFor(eng)])),
      runScope,
    })
  }

  const toggleEngine = (engine: EngineId) => {
    setEngines((prev) =>
      prev.includes(engine) ? prev.filter((e) => e !== engine) : [...prev, engine],
    )
  }

  // Audit is running: show progress view.
  if (runningAuditId) {
    const status = auditStatus
    const progress = runningAudit?.progress
    const spend = runningAudit?.spend
    const errorMessage = runningAudit?.error ?? eventsQuery.data?.job.error
    const events = eventsQuery.data?.events ?? []
    const currentStage =
      runningAudit?.timeline?.find((s) => s.status === 'running')?.label ?? runningAudit?.stage

    // Engine plan: prefer the backend-resolved allocation, else form state.
    const plan: { id: string; count: number }[] = runningAudit?.enginePlan
      ? Object.entries(runningAudit.enginePlan).map(([id, count]) => ({ id, count }))
      : (runningAudit?.engines ?? engines).map((id) => ({
          id,
          count: allocationFor(id as EngineId),
        }))

    const headerStats = [
      ...(progress !== undefined
        ? [{ label: 'Progress', value: `${Math.round(progress)}%` }]
        : []),
      ...(runningAudit
        ? [{ label: 'Elapsed', value: fmtClock(elapsed), sub: 'since start' }]
        : []),
      ...(spend
        ? [{ label: 'Est. spend', value: fmtUsd(spend.estimatedUsd), sub: `${spend.calls} API calls` }]
        : []),
    ]

    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          kicker="New Engagement · Running"
          title={status === 'failed' ? 'Audit failed' : 'Audit running'}
          description={
            status === 'failed'
              ? 'Something went wrong while running this audit.'
              : `Collecting answers for ${companyName || runningAudit?.companyName || 'this company'} across ${(
                  runningAudit?.engines ?? engines
                )
                  .map(engineLabel)
                  .join(', ')}.`
          }
          stats={headerStats.length > 0 ? headerStats : undefined}
        />

        {/* Pipeline stepper — the at-a-glance stage map, above timeline + feed. */}
        <Card
          title="Pipeline"
          meta={
            status === 'completed'
              ? 'all stages complete'
              : status === 'failed'
                ? 'stopped on error'
                : (currentStage ?? 'starting…')
          }
        >
          <PipelineStepper
            timeline={runningAudit?.timeline}
            stage={runningAudit?.stage ?? eventsQuery.data?.job.stage}
            status={status}
          />
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card
            title={status === 'failed' ? 'Failure' : 'Progress'}
            meta={companyName || runningAudit?.companyName}
            className="lg:col-span-3"
          >
            {/* Engine plan chips: which engines run, and how many prompts each. */}
            <div className="flex flex-wrap items-center gap-2">
              {plan.map(({ id, count }) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] px-2 py-[5px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-[#5B8DEF]"
                  style={{ backgroundColor: '#5B8DEF1F' }}
                >
                  {engineLabel(id)}
                  <span className="tabular-nums">{count}</span>
                </span>
              ))}
            </div>
            {runningAudit?.avatar && (
              <p className="mt-2 truncate text-[12px] text-[#5C5C66]" title={runningAudit.avatar}>
                Avatar · {runningAudit.avatar}
              </p>
            )}

            {/* Animated stage indicator. */}
            {!auditTerminal && (
              <div className="mt-4 flex items-center gap-2.5 rounded-[10px] border border-[#16161A] bg-[#0E0E11] px-3 py-2.5">
                <span className="pulse-dot h-2 w-2 shrink-0 rounded-full bg-[#5B8DEF]" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
                  Current stage
                </span>
                <span className="truncate text-[12px] text-white">
                  {currentStage ?? 'Starting pipeline…'}
                </span>
              </div>
            )}

            <div className="mt-5">
              {runningAudit ? (
                <AuditTimeline audit={runningAudit} />
              ) : (
                status !== 'failed' && (
                  <div>
                    <div className="h-[6px] overflow-hidden rounded-full bg-[#16161A]">
                      <div
                        className="h-full rounded-full transition-[width] duration-200"
                        style={{ width: '5%', backgroundColor: '#5B8DEF' }}
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[12px] text-[#8A8A93]">
                      <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#A78BFA]" />
                      Working…
                    </div>
                  </div>
                )
              )}
            </div>

            {status === 'failed' && (
              <div className="mt-5 rounded-[10px] border border-[#F06A6A]/40 bg-[#F06A6A]/10 px-4 py-3">
                <div className="text-[13px] font-medium text-[#F06A6A]">Pipeline error</div>
                <p className="mt-1 break-words text-[12px] leading-relaxed text-[#C9C9D1]">
                  {errorMessage ?? 'The backend did not report an error message.'}
                </p>
              </div>
            )}
            {retryMutation.isError && (
              <p className="mt-3 text-[12px] text-[#F06A6A]">
                {retryMutation.error instanceof ApiError
                  ? retryMutation.error.message
                  : `Retry request failed. Is the backend running on ${API_HOST}?`}
              </p>
            )}
            {cancelMutation.isError && (
              <p className="mt-3 text-[12px] text-[#F06A6A]">
                {cancelMutation.error instanceof ApiError
                  ? cancelMutation.error.message
                  : `Could not cancel the run. Is the backend running on ${API_HOST}?`}
              </p>
            )}

            {status === 'completed' && runningAudit && <CompletedSummary audit={runningAudit} />}
            <div className="mt-5 flex flex-wrap gap-2">
              {status === 'completed' && (
                <>
                  <PrimaryButton
                    onClick={() => window.open(getReportPdfUrl(runningAuditId), '_blank')}
                  >
                    Open PDF Report
                  </PrimaryButton>
                  {runningAudit?.companyId && (
                    <OutlineButton onClick={() => navigate(`/clients/${runningAudit.companyId}`)}>
                      View Client
                    </OutlineButton>
                  )}
                </>
              )}
              {status === 'failed' && (
                <>
                  <PrimaryButton
                    onClick={() => retryMutation.mutate()}
                    disabled={retryMutation.isPending}
                  >
                    {retryMutation.isPending ? 'Retrying…' : 'Retry'}
                  </PrimaryButton>
                  <OutlineButton
                    onClick={() => {
                      setRunningAuditId(null)
                      createMutation.reset()
                      retryMutation.reset()
                    }}
                  >
                    New audit
                  </OutlineButton>
                </>
              )}
              {!auditTerminal && (
                <OutlineButton
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                >
                  {cancelMutation.isPending ? 'Cancelling…' : 'Cancel audit'}
                </OutlineButton>
              )}
              <OutlineButton onClick={() => navigate('/')}>Back to Dashboard</OutlineButton>
            </div>
          </Card>

          <Card
            title="Live activity"
            meta="pipeline log"
            className="lg:col-span-2"
            right={
              !auditTerminal ? (
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-[#8A8A93]">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#A78BFA]" />
                  Live · refreshes every 2s
                </div>
              ) : undefined
            }
          >
            <LiveActivityFeed events={events} live={!auditTerminal} />
          </Card>
        </div>
        {status === 'completed' && runningAudit?.companyId && (
          <GeneratedFilesCard companyId={runningAudit.companyId} locations={runningAudit.locations} />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        kicker="New Engagement"
        title="Run Audit"
        description="Measure how often AI engines mention and cite a company across a fixed prompt set."
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Card title="Audit setup" meta="all rates are measured against this prompt set">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="companyName" className={labelClass}>
                Company name
              </label>
              <input
                id="companyName"
                className={inputClass}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme GmbH"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="websiteUrl" className={labelClass}>
                Website URL
              </label>
              <input
                id="websiteUrl"
                type="url"
                className={inputClass}
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
                required
              />
              {lookupPending && <p className="text-[11px] text-[#5C5C66]">Looking up company…</p>}
              {!lookupPending && lookupDescription && (
                <p className="text-[12px] text-[#5C5C66]">{lookupDescription}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Industry / sector</span>
              <Select
                className="w-full"
                ariaLabel="Industry / sector"
                placeholder="Select a sector…"
                options={SECTOR_SELECT_OPTIONS}
                value={sectorChoice}
                onChange={(value) => {
                  industryTouched.current = true
                  setSectorChoice(value)
                  // "Other…" hands ownership of `industry` to the text input.
                  setIndustry(value === SECTOR_OTHER ? '' : value)
                }}
              />
              {sectorChoice === SECTOR_OTHER && (
                <input
                  id="industry"
                  className={inputClass}
                  value={industry}
                  onChange={(e) => {
                    industryTouched.current = true
                    setIndustry(e.target.value)
                  }}
                  placeholder="Describe the sector…"
                  aria-label="Industry / sector (other)"
                  autoFocus
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Locations</span>
              <TickSet
                mode="multi"
                ariaLabel="Locations"
                options={LOCATION_OPTIONS}
                selected={locations}
                onChange={setLocations}
              />
              <p className="text-[11px] text-[#5C5C66]">
                Select one or more locations. A separate report + landing page set will be generated in DE and EN per location.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="avatar" className={labelClass}>
                Avatar (target audience)
              </label>
              <textarea
                id="avatar"
                rows={3}
                className={`${inputClass} resize-y leading-relaxed`}
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="CEO of a small-to-mid-size company looking for social media marketing"
              />
              <p className="text-[11px] text-[#5C5C66]">
                Optional. Describe the buyer this audit should impersonate — prompts are generated
                from that person's perspective and the AI engines are queried as if they asked.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="promptCount" className={labelClass}>
                Number of prompts
              </label>
              <NumberField
                id="promptCount"
                className="w-[120px]"
                min={1}
                max={500}
                value={promptCount}
                onChange={setPromptCount}
              />
              <p className="text-[11px] text-[#5C5C66]">
                Default prompts per engine. Recommended: 50 for standard coverage; 100 for deeper
                analysis. Override per engine below.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className={labelClass}>Engines & prompt allocation</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ENGINE_OPTIONS.map((opt) => {
                  const selected = engines.includes(opt.value)
                  return (
                    <div
                      key={opt.value}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-[#16161A] bg-[#0E0E11] px-3 py-2"
                    >
                      <div
                        role="checkbox"
                        aria-checked={selected}
                        tabIndex={0}
                        onClick={() => toggleEngine(opt.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleEngine(opt.value)
                          }
                        }}
                        className={`inline-flex cursor-pointer select-none items-center gap-1.5 text-[12px] outline-none transition-colors duration-150 ${
                          selected ? '' : 'text-[#8A8A93] hover:text-white'
                        }`}
                        style={selected ? { color: 'var(--accent, #69bff3)' } : undefined}
                      >
                        {selected && <Check size={12} strokeWidth={2} />}
                        {opt.label}
                      </div>
                      {selected ? (
                        <div className="flex items-center gap-1.5">
                          <NumberField
                            className="w-[86px]"
                            min={0}
                            max={500}
                            aria-label={`${opt.label} prompt allocation`}
                            value={allocationFor(opt.value)}
                            onChange={(n) =>
                              setAllocations((prev) => ({ ...prev, [opt.value]: n }))
                            }
                          />
                          <span className="text-[11px] text-[#5C5C66]">prompts</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#3F3F47]">off</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-[#5C5C66]">Presets:</span>
                <button
                  type="button"
                  onClick={() => {
                    setEngines(ENGINE_OPTIONS.map((e) => e.value))
                    setAllocations({ ...FOCUSED_PRESET })
                  }}
                  className="rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150"
                  style={{ border: '1px solid #1C1C21' }}
                >
                  Focused 20/20/10/10
                </button>
                <button
                  type="button"
                  onClick={() => setAllocations({})}
                  className="rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150"
                  style={{ border: '1px solid #1C1C21' }}
                >
                  Uniform ({promptCount} each)
                </button>
              </div>
              <p className="text-[12px] tabular-nums text-[#8A8A93]">
                <span className="font-medium text-white">{totalCalls}</span> total engine calls ·
                estimated cost ~<span className="text-white">${estCostUsd.toFixed(2)}</span>{' '}
                <span className="text-[#5C5C66]">(≈ $0.02/call average)</span>
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className={labelClass}>What to run</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {RUN_SCOPE_OPTIONS.map((opt) => {
                  const selected = runScope === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRunScope(opt.value)}
                      className="flex flex-col items-start gap-1 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150"
                      style={{
                        border: `1px solid ${selected ? 'rgba(167,139,250,.45)' : '#16161A'}`,
                        backgroundColor: selected ? 'rgba(167,139,250,.10)' : '#0E0E11',
                      }}
                    >
                      <span
                        className="flex items-center gap-1.5 text-[13px] font-medium"
                        style={{ color: selected ? '#A78BFA' : '#C9C9D1' }}
                      >
                        {selected && <Check size={12} strokeWidth={2.5} />}
                        {opt.label}
                      </span>
                      <span className="text-[11px] leading-[1.45] text-[#6B6B76]">{opt.detail}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-[#5C5C66]">
                Each option runs the same pipeline and stops later: every scope measures the engines,
                scores visibility and produces the report data. Shorter runs finish sooner and cost less.
              </p>
            </div>
          </div>
        </Card>

        {createMutation.isError && (
          <p className="text-[13px] text-[#F06A6A]">
            {/* A rejection from the backend carries a real reason — show it.
                Only transport failures fall back to the "is it running?" hint. */}
            {createMutation.error instanceof ApiError
              ? createMutation.error.message
              : `Failed to start the audit. Is the backend running on ${API_HOST}?`}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <OutlineButton onClick={() => navigate('/')}>Cancel</OutlineButton>
          <PrimaryButton type="submit" disabled={!canSubmit}>
            {createMutation.isPending ? 'Starting…' : 'Start Audit'}
          </PrimaryButton>
        </div>
      </form>
    </div>
  )
}
