/**
 * The agent's own step-by-step plan, mirrored onto the project board.
 *
 * Claude Code builds a todo list to work through a task, and it already knows
 * exactly which step is next and which are finished -- but that lived only in
 * the transcript, so the board never showed the plan and never showed it being
 * worked off. Asked for directly: the steps an agent means to do should be on
 * the board "van tasks die gedaan moeten worden tot die gedaan zijn".
 *
 * This runs as a `PostToolUse` hook with `matcher: "TodoWrite"` -- verified
 * against code.claude.com/docs/en/hooks.md: that event receives `tool_name`,
 * `tool_input` and the session's `cwd` on stdin, and the matcher is an exact
 * tool-name match. So every time the agent revises its plan, we see the whole
 * new list and can bring the board level with it.
 *
 * Deliberately conservative:
 *  - One board item per distinct step, matched on its text, so revising a plan
 *    updates the same items instead of stacking duplicates.
 *  - A finished step becomes `works`, never `done` and never verified: the agent
 *    saying it did something is a claim, and confirming it stays the user's.
 *  - Steps are never deleted when they leave the agent's list. The plan is the
 *    agent's working memory; the board is the record.
 *  - Every failure is swallowed. A hook that throws would surface as a tool
 *    error to the agent mid-task, and a tracker problem must never do that.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const newId = (p) => p + randomUUID().replace(/-/g, '').slice(0, 12)
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Claude Code's todo states, mapped onto the board's columns. */
const STATUS = { pending: 'todo', in_progress: 'wip', completed: 'works' }

/** A step's text, tolerating the field names different agents may use. */
function textOf(todo) {
  if (typeof todo === 'string') return todo
  for (const k of ['content', 'text', 'title', 'task', 'activeForm', 'description']) {
    const v = todo?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/** Only a real project directory, never a home directory or a stray cwd. */
const MARKERS = ['.planide', '.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
function resolveProject(cwd) {
  const raw = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : ''
  if (!raw) return null
  const path = resolve(raw)
  if (!existsSync(path)) return null
  if (path === resolve(homedir())) return null
  return MARKERS.some((m) => existsSync(join(path, m))) ? path : null
}

function loadState(project) {
  const file = join(project, '.planide', 'state.json')
  if (!existsSync(file)) {
    return {
      id: newId('p_'),
      name: basename(project.replace(/[/\\]+$/, '')) || 'project',
      path: project,
      type: 'custom',
      stack: { detected: {}, custom: '' },
      version: '0.1.0',
      created_at: nowIso(),
      updated_at: nowIso(),
      items: [],
      fixes: [],
      milestones: [],
      versions: [],
      activity: []
    }
  }
  const state = JSON.parse(readFileSync(file, 'utf8'))
  state.items ??= []
  state.activity ??= []
  return state
}

function saveState(project, state) {
  state.updated_at = nowIso()
  mkdirSync(join(project, '.planide'), { recursive: true })
  const file = join(project, '.planide', 'state.json')
  // Same pid-unique temp + rename the IDE and the MCP server use: several
  // writers touch this file by design, and they must not share a temp name.
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function logActivity(state, kind, text, who) {
  state.activity.unshift({ id: newId('a_'), at: nowIso(), kind, text, who: who || 'agent' })
  if (state.activity.length > 500) state.activity.length = 500
}

async function main() {
  const raw = readStdin()
  if (!raw.trim()) return
  const payload = JSON.parse(raw)
  // The matcher should already have narrowed this, but a settings.json edited by
  // hand could widen it, and syncing a Bash call as a plan would be nonsense.
  if (payload.tool_name && payload.tool_name !== 'TodoWrite') return

  const todos = payload?.tool_input?.todos
  if (!Array.isArray(todos) || todos.length === 0) return

  const project = resolveProject(payload.cwd)
  if (!project) return

  const agent = String(payload.agent_type || 'agent').slice(0, 40)
  const state = loadState(project)
  const before = JSON.parse(JSON.stringify({ items: state.items, fixes: state.fixes ?? [], milestones: state.milestones ?? [], version: state.version }))

  let added = 0
  let moved = 0
  for (const todo of todos) {
    const title = textOf(todo)
    if (!title) continue
    const status = STATUS[String(todo?.status || 'pending')] ?? 'todo'
    const key = norm(title)
    const item = state.items.find((i) => norm(i.title) === key)
    if (!item) {
      state.items.push({
        id: newId('i_'),
        title: title.length > 160 ? `${title.slice(0, 159)}…` : title,
        status,
        notes: '',
        tags: ['plan'],
        priority: 'normal',
        created_at: nowIso(),
        updated_at: nowIso(),
        claimed_by: agent,
        verified: false,
        verified_at: '',
        verified_by: '',
        locked: false,
        locked_at: ''
      })
      added += 1
      continue
    }
    // A step the user has protected is theirs; never move it from a plan.
    if (item.locked) continue
    if (item.status !== status) {
      item.status = status
      item.updated_at = nowIso()
      if (!item.claimed_by) item.claimed_by = agent
      // A status change drops a stale confirmation, exactly as the board does.
      if (item.verified) {
        item.verified = false
        item.verified_at = ''
        item.verified_by = ''
      }
      moved += 1
    }
  }

  if (!added && !moved) return
  logActivity(state, 'plan-sync', `plan: ${added} new step(s), ${moved} moved`, agent)
  saveState(project, state)

  // The durable record, so the plan's history survives the board's 500-line cap.
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const { recordDiff } = await import(join(here, '..', 'tracker', 'mcp', 'history-db.mjs'))
    recordDiff(project, before, state, agent)
  } catch {
    /* history is memory, not the ledger */
  }
}

try {
  await main()
} catch {
  // Never fail the agent's tool call over a tracker write.
}
