import { Fragment } from 'react'
import {
  Check,
  ClipboardList,
  FileText,
  Gauge,
  LayoutTemplate,
  ListChecks,
  MessageSquareText,
  Microscope,
  Radar,
  ShieldCheck,
  Swords,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { AuditStageInfo, AuditStageStatus, AuditStatus } from '@/lib/api'

// The 10 pipeline stages in backend order, with compact labels + icons.
const STAGES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'intake', label: 'Intake', icon: ClipboardList },
  { key: 'promptgen', label: 'Prompts', icon: MessageSquareText },
  { key: 'audit', label: 'Audit', icon: Radar },
  { key: 'verify', label: 'Verify', icon: ShieldCheck },
  { key: 'score', label: 'Score', icon: Gauge },
  { key: 'reverse', label: 'Teardowns', icon: Microscope },
  { key: 'competitors', label: 'Competitors', icon: Swords },
  { key: 'report', label: 'Report', icon: FileText },
  { key: 'actions', label: 'Actions', icon: ListChecks },
  { key: 'pages', label: 'Pages', icon: LayoutTemplate },
]

const ACTIVE = '#E8A04C'
const DONE = '#A78BFA'
const FAILED = '#F06A6A'

interface StepState {
  key: string
  label: string
  icon: LucideIcon
  status: AuditStageStatus
}

/**
 * Resolve per-step statuses. Prefers the audit `timeline` payload; without
 * one (e.g. a company-card job that only knows its current stage) the stage
 * ordinal decides: earlier = done, current = running, later = pending.
 */
function resolveSteps(
  timeline: AuditStageInfo[] | null | undefined,
  stage: string | undefined,
  jobStatus: AuditStatus | undefined,
): StepState[] {
  if (timeline && timeline.length > 0) {
    return timeline.map((s) => {
      const meta = STAGES.find((m) => m.key === s.stage)
      return {
        key: s.stage,
        label: meta?.label ?? s.label,
        icon: meta?.icon ?? FileText,
        status: s.status,
      }
    })
  }
  const idx = stage ? STAGES.findIndex((s) => s.key === stage) : -1
  return STAGES.map((s, i) => {
    let status: AuditStageStatus = 'pending'
    if (jobStatus === 'completed') status = 'done'
    else if (idx === -1) status = i === 0 && jobStatus === 'running' ? 'running' : 'pending'
    else if (i < idx) status = 'done'
    else if (i === idx) status = jobStatus === 'failed' ? 'failed' : 'running'
    return { key: s.key, label: s.label, icon: s.icon, status }
  })
}

function Node({ status, icon: Icon }: { status: AuditStageStatus; icon: LucideIcon }) {
  if (status === 'done') {
    return (
      <span
        className="stepper-pop flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: DONE }}
      >
        <Check size={16} strokeWidth={3} className="text-white" />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span
        className="stepper-pop flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: FAILED }}
      >
        <X size={16} strokeWidth={3} className="text-white" />
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span
        className="stepper-glow flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: ACTIVE }}
      >
        <Icon size={16} strokeWidth={1.75} className="text-[#0B0B0D]" />
      </span>
    )
  }
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#3F3F47]">
      <Icon size={15} strokeWidth={1.5} className="text-[#5C5C66]" />
    </span>
  )
}

/** Connector between two nodes; fills accent purple (sweep left→right) once the
 *  step to its left is done. */
function Connector({ filled }: { filled: boolean }) {
  return (
    <span className="relative mt-[17px] h-[2px] min-w-[16px] flex-1 overflow-hidden rounded-full bg-[#1C1C21]">
      {/* w-full is the resting width; the sweep animation overrides it while
          playing, so reduced-motion users still get a filled line. */}
      {filled && (
        <span
          className="stepper-fill absolute inset-y-0 left-0 w-full"
          style={{ backgroundColor: DONE }}
        />
      )}
    </span>
  )
}

function labelColor(status: AuditStageStatus): string {
  if (status === 'running') return ACTIVE
  if (status === 'failed') return FAILED
  if (status === 'done') return '#C9C9D1'
  return '#5C5C66'
}

export function PipelineStepper({
  timeline,
  stage,
  status,
  variant = 'full',
  className = '',
}: {
  /** Full per-stage timeline from GET /api/audits/:id, when available. */
  timeline?: AuditStageInfo[] | null
  /** Current stage id (fallback driver when no timeline, e.g. company jobs). */
  stage?: string
  /** Job/audit status — decides all-done / failed rendering in fallback mode. */
  status?: AuditStatus
  variant?: 'full' | 'mini'
  className?: string
}) {
  const steps = resolveSteps(timeline, stage, status)
  const active = steps.find((s) => s.status === 'running' || s.status === 'failed')
  const doneCount = steps.filter((s) => s.status === 'done').length
  const summary = active
    ? `Pipeline: stage ${doneCount + 1} of ${steps.length} — ${active.label}`
    : `Pipeline: ${doneCount} of ${steps.length} stages complete`

  if (variant === 'mini') {
    // Read-only micro variant for client cards: dots + hairline connectors.
    return (
      <span
        role="img"
        aria-label={summary}
        title={summary}
        className={`inline-flex items-center ${className}`}
      >
        {steps.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && (
              <span
                className="h-px w-2"
                style={{
                  backgroundColor: steps[i - 1].status === 'done' ? DONE : '#1C1C21',
                }}
              />
            )}
            {s.status === 'running' ? (
              <span
                className="stepper-glow h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ backgroundColor: ACTIVE }}
              />
            ) : (
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={
                  s.status === 'done'
                    ? { backgroundColor: DONE }
                    : s.status === 'failed'
                      ? { backgroundColor: FAILED }
                      : { border: '1px solid #3F3F47' }
                }
              />
            )}
          </Fragment>
        ))}
      </span>
    )
  }

  return (
    <div role="img" aria-label={summary} className={`overflow-x-auto pb-1 ${className}`}>
      <div className="flex min-w-[760px] items-start">
        {steps.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && <Connector filled={steps[i - 1].status === 'done'} />}
            <div className="flex w-[68px] shrink-0 flex-col items-center gap-2">
              <Node status={s.status} icon={s.icon} />
              <span
                className={`max-w-full truncate text-center text-[10.5px] leading-tight transition-colors duration-150 ${
                  s.status === 'running' ? 'font-semibold' : 'font-medium'
                }`}
                style={{ color: labelColor(s.status) }}
                title={s.label}
              >
                {s.label}
              </span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
