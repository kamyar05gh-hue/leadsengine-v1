/**
 * SQLite client + migration runner — backed by the built-in node:sqlite
 * module (Node ≥23.4, no native compilation). better-sqlite3 was dropped
 * because it has no prebuilt binary for Node 26 / Windows ARM64 and this
 * machine has no MSVC toolchain; the DatabaseSync API surface used here
 * (exec / prepare().run/.all/.get) is deliberately kept identical so no
 * other module notices the swap.
 *
 * Migrations are ordered *.sql files in this directory (schema.sql = base).
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PATHS } from '../config.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))

let db: DatabaseSync | null = null

export function connect(): DatabaseSync {
  if (db) return db
  fs.mkdirSync(path.dirname(PATHS.db), { recursive: true })
  db = new DatabaseSync(PATHS.db)
  db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(con: DatabaseSync): void {
  con.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
  const applied = new Set(
    (con.prepare('SELECT file FROM _migrations').all() as unknown as { file: string }[]).map(
      (r) => r.file,
    ),
  )
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      // schema.sql always first, then numbered migrations in order
      if (a === 'schema.sql') return -1
      if (b === 'schema.sql') return 1
      return a.localeCompare(b)
    })
  for (const file of files) {
    if (applied.has(file)) continue
    con.exec(fs.readFileSync(path.join(DIR, file), 'utf8'))
    con.prepare('INSERT INTO _migrations (file, applied_at) VALUES (?, ?)').run(
      file,
      new Date().toISOString(),
    )
    console.log(`[db] migration applied: ${file}`)
  }
}

/** Test/helper hook: close and reset the singleton (used by dry runs). */
export function resetForTests(): void {
  db?.close()
  db = null
}
