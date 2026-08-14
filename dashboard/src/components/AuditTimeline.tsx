import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import type { Audit, AuditStageInfo } from '@/lib/api'
import { fmtClock, fmtUsd } from '@/lib/format'

/** Animated count-up: tweens to `target` over ~0.6s whenever it increases. */
function useCountUp(target: number): number {
  const [display, setDisplay] = useState(target)
  const displayRef = useRef(target)
  useEffect(() => {
    const from = displayRef.current
    if (from === target) return
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / 600, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      const value = from + (target - from) * eased
      displayRef.current = value
      setDisplay(value)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return display
}

/** Ticking seconds elapsed since `createdAt` (1s interval, cleaned up). */
function useElapsedSeconds(createdAt: string): number {
  const startMs = new Date(createdAt).getTime()
  const [elapsed, setElapsed] = useState(() => Math.max(0, (Date.now() - startMs) / 1000))
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, (Date.now() - startMs) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [startMs])
  return elapsed
}

/** Stage duration: `Xs` under a minute, `M:SS` above. */
function fmtStageDuration(ms: number): string {
  const s = ms / 1000
  return s < 60 ? `${Math.round(s)}s` : fmtClock(s)
}

function fmtTimestamp(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
}

// Old backend without `timeline`: the pre-timeline progress bar, unchanged.
function FallbackProgress({ audit }: { audit: Audit }) {
  if (audit.status === 'failed') return null
  const progress = audit.progress
  return (
    <div>
      <div className="h-[6px] overflow-hidden rounded-full bg-[#16161A]">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{ width: `${Math.min(progress ?? 5, 100)}%`, backgroundColor: '#5B8DEF' }}
        />
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-[#8A8A93]">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#A78BFA]" />
        {progress !== undefined ? `${Math.round(progress)}% complete` : 'Working…'}
      </div>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  sub,
  children,
}: {
  label: string
  value: string
  sub?: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-[12px] border border-[#16161A] bg-[#0E0E11] px-4 py-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
        {label}
      </div>
      <div className="mt-2 text-[20px] font-medium tabular-nums text-white">{value}</div>
      {sub && <div className="mt-1 text-[11px] tabular-nums text-[#5C5C66]">{sub}</div>}
      {children}
    </div>
  )
}

function StepDot({ status }: { status: AuditStageInfo['status'] }) {
  if (status === 'done') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#A78BFA]">
        <Check size={10} strokeWidth={3} className="text-[#0B0B0D]" />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#F06A6A]">
        <X size={10} strokeWidth={3} className="text-[#0B0B0D]" />
      </span>
    )
  }
  if (status === 'running') {
    return <span className="pulse-dot my-[3px] h-2.5 w-2.5 rounded-full bg-[#5B8DEF]" />
  }
  return <span className="my-[3px] h-2.5 w-2.5 rounded-full border border-[#3F3F47]" />
}

function StepRow({
  step,
  isLast,
  expanded,
  onToggle,
}: {
  step: AuditStageInfo
  isLast: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const expandable =
    step.status === 'done' ||
    step.status === 'failed' ||
    (step.status === 'running' && !!step.lastMessage)
  const running = step.status === 'running'
  const started = fmtTimestamp(step.startedAt)
  const finished = fmtTimestamp(step.finishedAt)

  return (
    <div className="flex gap-3">
      {/* Rail: dot + connector segment. The segment under a done step fills
          with #5B8DEF via a height transition. */}
      <div className="flex w-4 shrink-0 flex-col items-center">
        <StepDot status={step.status} />
        {!isLast && (
          <span className="relative mt-1 w-px flex-1 overflow-hidden bg-[#1C1C21]">
            <span
              className="absolute left-0 top-0 w-full bg-[#5B8DEF] transition-[height] duration-200 ease"
              style={{ height: step.status === 'done' ? '100%' : '0%' }}
            />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <button
          type="button"
          disabled={!expandable}
          onClick={onToggle}
          aria-expanded={expandable ? expanded : undefined}
          className="group block w-full text-left"
        >
          <span className="flex items-baseline justify-between gap-3">
            <span
              className={`flex min-w-0 items-center gap-1.5 text-[13px] transition-colors duration-150 ${
                running ? 'text-white' : 'text-[#C9C9D1]'
              } ${expandable ? 'group-hover:text-white' : ''}`}
            >
              <span className="truncate">{step.label}</span>
              {expandable && (
                <ChevronDown
                  size={14}
                  strokeWidth={1.5}
                  className={`shrink-0 text-[#5C5C66] transition-transform duration-150 ${
                    expanded ? 'rotate-180' : ''
                  }`}
                />
              )}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-[#5C5C66]">
              {step.durationMs !== null && fmtStageDuration(step.durationMs)}
              {step.durationMs !== null && step.estimatedUsd > 0 && ' · '}
              {step.estimatedUsd > 0 && fmtUsd(step.estimatedUsd)}
            </span>
          </span>
          {running && step.lastMessage && (
            <span className="mt-1 flex items-center gap-2 text-[12px] text-[#8A8A93]">
              <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[#5B8DEF]" />
              <span className="truncate">{step.lastMessage}</span>
            </span>
          )}
        </button>

        {expandable && (
          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-150 ease ${
              expanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="mt-2 rounded-[10px] border border-[#16161A] bg-[#0E0E11] px-3 py-2.5">
              {step.lastMessage && (
                <p className="text-[12px] leading-relaxed text-[#8A8A93]">{step.lastMessage}</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-[#5C5C66]">
                {started && <span>Started {started}</span>}
                {finished && <span>Finished {finished}</span>}
                {step.durationMs !== null && <span>Duration {fmtStageDuration(step.durationMs)}</span>}
                {step.calls > 0 && <span>{step.calls} API calls</span>}
                {step.estimatedUsd > 0 && <span>{fmtUsd(step.estimatedUsd)}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Live audit progress: summary strip (spend / elapsed / ETA / progress)
 * plus a vertical step rail over the 10 pipeline stages. Falls back to the
 * plain progress bar when the backend does not send `timeline` yet.
 */
export function AuditTimeline({ audit }: { audit: Audit }) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const elapsed = useElapsedSeconds(audit.createdAt)
  const timeline = audit.timeline
  // Derive spend from the stages when the top-level aggregate is absent.
  const spend = audit.spend ?? {
    calls: timeline?.reduce((sum, s) => sum + s.calls, 0) ?? 0,
    estimatedUsd: timeline?.reduce((sum, s) => sum + s.estimatedUsd, 0) ?? 0,
  }
  const animatedSpend = useCountUp(spend.estimatedUsd)

  if (!timeline || timeline.length === 0) return <FallbackProgress audit={audit} />

  const doneCount = timeline.filter((s) => s.status === 'done').length
  const progress = audit.progress ?? (doneCount / timeline.length) * 100
  const terminal = audit.status === 'completed' || audit.status === 'failed'
  const eta =
    terminal || progress >= 100
      ? '—'
      : progress < 2 || audit.status === 'pending'
        ? 'calculating…'
        : fmtClock((elapsed / progress) * (100 - progress))

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="Estimated spend" value={fmtUsd(animatedSpend)} sub={`${spend.calls} API calls`} />
        <SummaryTile label="Elapsed" value={fmtClock(elapsed)} sub={`since ${fmtTimestamp(audit.createdAt) ?? ''}`} />
        <SummaryTile label="ETA" value={eta} />
        <SummaryTile label="Progress" value={`${Math.round(progress)}%`} sub={`${doneCount} of ${timeline.length} stages`}>
          <div className="mt-2.5 h-[6px] overflow-hidden rounded-full bg-[#16161A]">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: '#5B8DEF' }}
            />
          </div>
        </SummaryTile>
      </div>

      <div className="mt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5C5C66]">
        Pipeline stages
      </div>
      <div className="mt-3 flex flex-col">
        {timeline.map((step, i) => (
          <StepRow
            key={step.stage}
            step={step}
            isLast={i === timeline.length - 1}
            expanded={expandedStage === step.stage}
            onToggle={() => setExpandedStage(expandedStage === step.stage ? null : step.stage)}
          />
        ))}
      </div>
    </div>
  )
}
