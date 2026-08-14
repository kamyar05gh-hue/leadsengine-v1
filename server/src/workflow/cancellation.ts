/**
 * Cooperative job cancellation.
 *
 * Marking the job row `failed` is NOT enough to stop a workflow: the executor
 * runs in-process and its next progress update writes `running` straight back
 * over the cancellation (observed: a canceled job reappeared at audit 23%).
 * Worse, it keeps burning paid API calls for a company the operator is trying
 * to delete.
 *
 * So cancellation is a two-part contract:
 *   1. `requestCancel(jobId)` records the intent in this in-memory registry.
 *   2. The workflow checks `throwIfCanceled(jobId)` at every stage boundary,
 *      and the audit stage's worker loop checks `isCanceled` before each call,
 *      so an in-flight run stops within one API call instead of minutes later.
 *
 * The registry is intentionally in-memory: a process restart kills the
 * executor anyway, and the job row's `failed` status keeps it out of the
 * boot-time orphan resume.
 */

const canceled = new Set<string>()

/** Error thrown at a cancellation checkpoint. Carries the job id. */
export class CanceledError extends Error {
  constructor(public readonly jobId: string) {
    super('canceled by operator')
    this.name = 'CanceledError'
  }
}

/** Ask a running workflow to stop at its next checkpoint. */
export function requestCancel(jobId: string): void {
  canceled.add(jobId)
}

/** True when a cancellation has been requested for this job. */
export function isCanceled(jobId: string): boolean {
  return canceled.has(jobId)
}

/**
 * Drop a cancellation flag — called when a job is retried, so the resumed
 * run is not killed by a stale request from its previous life.
 */
export function clearCancel(jobId: string): void {
  canceled.delete(jobId)
}

/** Stage-boundary checkpoint: aborts the workflow when cancellation is pending. */
export function throwIfCanceled(jobId: string): void {
  if (canceled.has(jobId)) throw new CanceledError(jobId)
}
