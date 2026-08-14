/**
 * SQLite-backed job queue — one workflow per company, executed in-process.
 *
 * Design: jobs advance through a fixed stage list (see pipeline.ts). Each
 * stage handler is idempotent — it checks what already exists in the DB and
 * only does the missing work, so a failed job can resume with `retry` and
 * never re-pays for completed API calls. Progress (0..100) is written to the
 * job row; the dashboard polls it.
 */
import { randomUUID } from 'node:crypto'
import { connect } from '../db/client.js'
import type { Job, JobStatus, StageName } from '../types.js'

const now = () => new Date().toISOString()

export function createJob(companyId: string): Job {
  const job: Job = {
    id: randomUUID(),
    companyId,
    status: 'queued',
    stage: 'intake',
    progress: 0,
    createdAt: now(),
    updatedAt: now(),
  }
  connect()
    .prepare(
      `INSERT INTO jobs (id, company_id, status, stage, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(job.id, job.companyId, job.status, job.stage, job.progress, job.createdAt, job.updatedAt)
  return job
}

export function getJob(id: string): Job | null {
  const row = connect().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToJob(row) : null
}

export function latestJobFor(companyId: string): Job | null {
  const row = connect()
    .prepare('SELECT * FROM jobs WHERE company_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(companyId) as Record<string, unknown> | undefined
  return row ? rowToJob(row) : null
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, 'status' | 'stage' | 'progress' | 'error'>>,
): void {
  const cur = getJob(id)
  if (!cur) return
  connect()
    .prepare('UPDATE jobs SET status = ?, stage = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.status ?? cur.status,
      patch.stage ?? cur.stage,
      patch.progress ?? cur.progress,
      patch.error ?? null,
      now(),
      id,
    )
}

export function logEvent(jobId: string, stage: StageName, message: string): void {
  connect()
    .prepare('INSERT INTO job_events (job_id, stage, message, at) VALUES (?, ?, ?, ?)')
    .run(jobId, stage, message, now())
}

export function jobEvents(jobId: string): { stage: StageName; message: string; at: string }[] {
  return connect()
    .prepare('SELECT stage, message, at FROM job_events WHERE job_id = ? ORDER BY id')
    .all(jobId) as unknown as { stage: StageName; message: string; at: string }[]
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    status: String(row.status) as JobStatus,
    stage: String(row.stage) as StageName,
    progress: Number(row.progress),
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
