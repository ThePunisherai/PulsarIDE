/**
 * What each agent session on a board is in the middle of -- the autopilot's
 * memory between one hook call and the next.
 *
 * Kept beside the board in `.planide/sessions.json`, not inside state.json:
 * the board is the record the IDE watches and history replays, and a turn
 * counter is neither. Writing it never wakes the IDE (board-watch reacts to
 * state.json only), and losing it costs one turn of autopilot, nothing more.
 *
 * One record per session id, as the agent's own hooks hand it over:
 *   mark    the board's fingerprint at the start of the turn, or at the last push
 *   worked  this session's own plan wrote the board this turn
 *   drive   the user's prompt this turn was "carry on"
 *   pushes  continuations handed out this turn
 *   seen    last time any hook heard from it -- records idle a week are dropped
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = 'sessions.json'
const KEEP_MS = 7 * 24 * 3600e3

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Every session record of this board; an unreadable file reads as none. */
export function readSessions(project) {
  try {
    const raw = JSON.parse(readFileSync(join(project, '.planide', FILE), 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

/** One session's record, or null. */
export function readSession(project, id) {
  const all = readSessions(project)
  const rec = id ? all[id] : null
  return rec && typeof rec === 'object' ? rec : null
}

/**
 * Change one session's record: `fn` gets the current one (or null) and returns
 * the new one, or null to leave the file alone. Old records are dropped on the
 * way, and the write is atomic like every other writer of `.planide/`.
 */
export function updateSession(project, id, fn) {
  if (!id) return null
  const all = readSessions(project)
  const next = fn(all[id] && typeof all[id] === 'object' ? { ...all[id] } : null)
  if (!next) return null
  next.seen = nowIso()
  all[id] = next
  const cutoff = Date.now() - KEEP_MS
  for (const [k, v] of Object.entries(all)) {
    const t = Date.parse(v?.seen || '')
    if (!Number.isFinite(t) || t < cutoff) delete all[k]
  }
  const dir = join(project, '.planide')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = join(dir, FILE)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return next
}
