/**
 * The per-project history database.
 *
 * `state.json` is the live board -- the current shape of the work, and the one
 * source of truth the IDE and every agent read and write. It is deliberately
 * only the present: a task that moves todo -> wip -> works -> done keeps only
 * "done", and the `activity` log inside it is capped at 500 lines so a busy
 * project does not grow an unbounded JSON file the whole IDE must re-parse on
 * every read. That cap is correct for the board and wrong for memory: an agent
 * that works a project almost every day asked, in as many words, to "have all
 * the data" -- the full record of what moved and when, not the last 500 events.
 *
 * So this keeps that record beside the board, in `<project>/.planide/history.db`,
 * a real SQLite file written through Node's own `node:sqlite`. It ships in the
 * app's Node (Electron 43 / Node 24), so there is nothing to install -- the same
 * zero-dependency trick the tracker MCP server itself runs on.
 *
 * It is append-only and never read on the board's hot path. Every function here
 * is wrapped so that a missing `node:sqlite` (an older Node), a read-only disk,
 * or a locked file degrades to "no history recorded" and never once throws into
 * the board write -- history is memory, not the ledger, and losing a line of it
 * must never cost a real board update. That is why the board write in `mutate()`
 * completes first and this is called after, best-effort.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// Lazy, guarded load: `node:sqlite` is a Node 22.5+ builtin. If this app's Node
// ever lacks it, every function below no-ops instead of the whole tracker
// failing to import. Resolved once and cached (including the null case).
let _sqlite /** @type {{ DatabaseSync: any } | null | undefined} */
function sqlite() {
  if (_sqlite !== undefined) return _sqlite
  try {
    const require = createRequire(import.meta.url)
    _sqlite = require('node:sqlite')
  } catch {
    _sqlite = null
  }
  return _sqlite
}

const dbPath = (projectPath) => join(projectPath, '.planide', 'history.db')

/**
 * Open the history DB for a project, creating the schema on first use.
 * Returns null when SQLite is unavailable or the file cannot be opened.
 */
function open(projectPath) {
  const s = sqlite()
  if (!s) return null
  try {
    mkdirSync(join(projectPath, '.planide'), { recursive: true })
    const db = new s.DatabaseSync(dbPath(projectPath))
    // WAL keeps the append from blocking a concurrent read, and matches the
    // "the IDE and an agent both touch this project at once" reality the board
    // write already designs for.
    try { db.exec('PRAGMA journal_mode = WAL') } catch { /* not fatal */ }
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      TEXT NOT NULL,
        kind    TEXT NOT NULL,
        entity  TEXT NOT NULL,
        item_id TEXT,
        title   TEXT,
        field   TEXT,
        old     TEXT,
        new     TEXT,
        actor   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_item ON events(item_id);
    `)
    return db
  } catch {
    return null
  }
}

const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Index a collection by id, tolerating a missing/!array collection. */
function byId(list) {
  const m = new Map()
  for (const x of Array.isArray(list) ? list : []) {
    if (x && typeof x.id === 'string') m.set(x.id, x)
  }
  return m
}

const asText = (v) => {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return JSON.stringify(v)
  return String(v)
}

/**
 * The fields whose changes are worth a history row, per entity. Chosen rather
 * than "every field" so a re-serialised-but-unchanged board does not write
 * noise, and so the timeline reads as progress (status, verified) rather than
 * bookkeeping (updated_at).
 */
const TRACKED = {
  item: ['status', 'verified', 'locked', 'title', 'notes', 'claimed_by', 'tags'],
  fix: ['status', 'title', 'problem', 'solution'],
  milestone: ['done', 'title', 'target']
}

function diffCollection(db, entity, before, after, actor, ts) {
  const b = byId(before)
  const a = byId(after)
  const rows = []
  // Added.
  for (const [id, item] of a) {
    if (b.has(id)) continue
    rows.push([ts, `${entity}_added`, entity, id, asText(item.title), '', '', asText(item.status ?? item.done), actor])
  }
  // Removed.
  for (const [id, item] of b) {
    if (a.has(id)) continue
    rows.push([ts, `${entity}_removed`, entity, id, asText(item.title), '', asText(item.status ?? item.done), '', actor])
  }
  // Field changes on survivors.
  for (const [id, next] of a) {
    const prev = b.get(id)
    if (!prev) continue
    for (const field of TRACKED[entity]) {
      const oldV = asText(prev[field])
      const newV = asText(next[field])
      if (oldV !== newV) {
        rows.push([ts, `${entity}_changed`, entity, id, asText(next.title), field, oldV, newV, actor])
      }
    }
  }
  if (!rows.length) return 0
  const stmt = db.prepare(
    'INSERT INTO events(ts,kind,entity,item_id,title,field,old,new,actor) VALUES(?,?,?,?,?,?,?,?,?)'
  )
  for (const r of rows) stmt.run(...r)
  return rows.length
}

/**
 * Record everything that changed between two board snapshots.
 *
 * `before`/`after` are the whole state objects. Best-effort: any failure is
 * swallowed so the caller (which has already written the board) is never
 * affected. Returns the number of rows written, or 0.
 */
export function recordDiff(projectPath, before, after, actor = 'agent') {
  let db = null
  try {
    db = open(projectPath)
    if (!db) return 0
    const ts = iso()
    let n = 0
    n += diffCollection(db, 'item', before?.items, after?.items, actor, ts)
    n += diffCollection(db, 'fix', before?.fixes, after?.fixes, actor, ts)
    n += diffCollection(db, 'milestone', before?.milestones, after?.milestones, actor, ts)
    // Version bumps are a real project event and cheap to record.
    const ov = asText(before?.version)
    const nv = asText(after?.version)
    if (ov !== nv && nv) {
      db.prepare(
        'INSERT INTO events(ts,kind,entity,item_id,title,field,old,new,actor) VALUES(?,?,?,?,?,?,?,?,?)'
      ).run(ts, 'version_changed', 'project', '', 'version', 'version', ov, nv, actor)
      n += 1
    }
    return n
  } catch {
    return 0
  } finally {
    try { db?.close() } catch { /* nothing to do */ }
  }
}

/**
 * Read recent history for the UI. Newest first, bounded. Returns a plain array
 * (never throws) so the reader can be spawned and its stdout parsed as JSON.
 */
export function readHistory(projectPath, limit = 500) {
  let db = null
  try {
    db = open(projectPath)
    if (!db) return { available: false, events: [], total: 0 }
    const total = db.prepare('SELECT COUNT(*) c FROM events').get()?.c ?? 0
    const cap = Math.max(1, Math.min(5000, Number(limit) || 500))
    const events = db
      .prepare('SELECT ts,kind,entity,item_id AS itemId,title,field,old,new AS neu,actor FROM events ORDER BY id DESC LIMIT ?')
      .all(cap)
    return { available: true, events, total }
  } catch {
    return { available: false, events: [], total: 0 }
  } finally {
    try { db?.close() } catch { /* nothing to do */ }
  }
}
