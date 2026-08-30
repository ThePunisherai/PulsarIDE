/**
 * The per-project history database (main-process side).
 *
 * `state.json` is the live board -- only the present, and its `activity` log is
 * capped at 500 lines so a busy project does not grow without bound. That cap is
 * right for the board and wrong for memory: an agent that works a project almost
 * every day was promised "all the data", the full record of what moved and when.
 * This keeps that record beside the board in `<project>/.planide/history.db`, a
 * real SQLite file through Node's own `node:sqlite` -- which ships in the app's
 * runtime (Electron 43 / Node 24), so there is nothing to install.
 *
 * This is the twin of the tracker MCP server's `history-db.mjs`: the MCP process
 * (an agent's writes) records through that file, the IDE's own main process (the
 * UI's edits and the automatic agent-turn trail) records through this one, and
 * both append the same schema to the same DB. Kept deliberately literal against
 * that file so a diff between the two is easy to eyeball, exactly as the tracker
 * MCP server is kept a literal mirror of `store.ts`.
 *
 * Every function is wrapped so a missing `node:sqlite`, a read-only disk, or a
 * locked file degrades to "no history" and never throws into a board write --
 * history is memory, not the ledger, and losing a line of it must never cost a
 * real board update.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// `node:sqlite` is imported statically on purpose. This runs ONLY in the app's
// own main process -- always the bundled Electron 43 / Node 24, which ships it
// (verified) -- never the user's own node, so unlike the tracker MCP server (see
// its `history-db.mjs`, which can run under an older system node and so loads it
// defensively) the builtin is guaranteed present here. A dynamic
// `createRequire(import.meta.url)` load would additionally break once the main
// bundle is emitted as CommonJS, where `import.meta` does not exist. Every use
// below is still wrapped, so even an impossible missing binding degrades to "no
// history" rather than disturbing a board write.
type SqliteDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): Record<string, unknown> | undefined; all(...a: unknown[]): Record<string, unknown>[] }
  close(): void
}

/** One recorded change on the board. */
export type HistoryEvent = {
  ts: string
  kind: string
  entity: string
  itemId: string | null
  title: string | null
  field: string | null
  old: string | null
  neu: string | null
  actor: string | null
}

export type HistoryResult = { available: boolean; events: HistoryEvent[]; total: number }

/** A minimal shape of the board collections this diffs. */
type Boardish = {
  items?: Array<Record<string, unknown>>
  fixes?: Array<Record<string, unknown>>
  milestones?: Array<Record<string, unknown>>
  version?: unknown
}

const dbPath = (projectPath: string): string => join(projectPath, '.planide', 'history.db')
const iso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

function open(projectPath: string): SqliteDb | null {
  try {
    mkdirSync(join(projectPath, '.planide'), { recursive: true })
    const db = new DatabaseSync(dbPath(projectPath)) as unknown as SqliteDb
    try {
      db.exec('PRAGMA journal_mode = WAL')
    } catch {
      /* not fatal */
    }
    db.exec(
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL, kind TEXT NOT NULL, entity TEXT NOT NULL,
        item_id TEXT, title TEXT, field TEXT, old TEXT, new TEXT, actor TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_item ON events(item_id);`
    )
    return db
  } catch {
    return null
  }
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return JSON.stringify(v)
  return String(v)
}

function byId(list: Array<Record<string, unknown>> | undefined): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>()
  for (const x of Array.isArray(list) ? list : []) {
    if (x && typeof x.id === 'string') m.set(x.id, x)
  }
  return m
}

/** Fields whose changes are worth a row, per entity -- progress, not bookkeeping. */
const TRACKED: Record<string, string[]> = {
  item: ['status', 'verified', 'locked', 'title', 'notes', 'claimed_by', 'tags'],
  fix: ['status', 'title', 'problem', 'solution'],
  milestone: ['done', 'title', 'target']
}

function diffCollection(
  entity: string,
  before: Array<Record<string, unknown>> | undefined,
  after: Array<Record<string, unknown>> | undefined,
  actor: string,
  ts: string
): unknown[][] {
  const b = byId(before)
  const a = byId(after)
  const rows: unknown[][] = []
  for (const [id, item] of a) {
    if (b.has(id)) continue
    rows.push([ts, `${entity}_added`, entity, id, asText(item.title), '', '', asText(item.status ?? item.done), actor])
  }
  for (const [id, item] of b) {
    if (a.has(id)) continue
    rows.push([ts, `${entity}_removed`, entity, id, asText(item.title), '', asText(item.status ?? item.done), '', actor])
  }
  for (const [id, next] of a) {
    const prev = b.get(id)
    if (!prev) continue
    for (const field of TRACKED[entity]) {
      const oldV = asText(prev[field])
      const newV = asText(next[field])
      if (oldV !== newV) rows.push([ts, `${entity}_changed`, entity, id, asText(next.title), field, oldV, newV, actor])
    }
  }
  return rows
}

/**
 * Record everything that changed between two board snapshots. Best-effort:
 * returns the number of rows written, or 0, and never throws.
 */
export function recordHistory(projectPath: string, before: Boardish, after: Boardish, actor = 'you'): number {
  let db: SqliteDb | null = null
  try {
    db = open(projectPath)
    if (!db) return 0
    const ts = iso()
    const rows: unknown[][] = [
      ...diffCollection('item', before?.items, after?.items, actor, ts),
      ...diffCollection('fix', before?.fixes, after?.fixes, actor, ts),
      ...diffCollection('milestone', before?.milestones, after?.milestones, actor, ts)
    ]
    const ov = asText(before?.version)
    const nv = asText(after?.version)
    if (ov !== nv && nv) rows.push([ts, 'version_changed', 'project', '', 'version', 'version', ov, nv, actor])
    if (!rows.length) return 0
    const stmt = db.prepare(
      'INSERT INTO events(ts,kind,entity,item_id,title,field,old,new,actor) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    for (const r of rows) stmt.run(...r)
    return rows.length
  } catch {
    return 0
  } finally {
    try {
      db?.close()
    } catch {
      /* nothing to do */
    }
  }
}

/** Read recent history for the UI, newest first, bounded. Never throws. */
export function readProjectHistory(projectPath: string, limit = 500): HistoryResult {
  let db: SqliteDb | null = null
  try {
    db = open(projectPath)
    if (!db) return { available: false, events: [], total: 0 }
    const total = Number(db.prepare('SELECT COUNT(*) c FROM events').get()?.c ?? 0)
    const cap = Math.max(1, Math.min(5000, Number(limit) || 500))
    const rows = db
      .prepare(
        'SELECT ts,kind,entity,item_id AS itemId,title,field,old,new AS neu,actor FROM events ORDER BY id DESC LIMIT ?'
      )
      .all(cap)
    return { available: true, total, events: rows as unknown as HistoryEvent[] }
  } catch {
    return { available: false, events: [], total: 0 }
  } finally {
    try {
      db?.close()
    } catch {
      /* nothing to do */
    }
  }
}

/** A cheap snapshot of just the collections history diffs, for before/after use. */
export function historySnapshot(state: Boardish): Boardish {
  return {
    items: structuredClone(state.items ?? []),
    fixes: structuredClone(state.fixes ?? []),
    milestones: structuredClone(state.milestones ?? []),
    version: state.version
  }
}
