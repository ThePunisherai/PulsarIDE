/**
 * The agent's own step-by-step plan, mirrored onto the project board.
 *
 * Claude Code builds a todo list to work through a task, and it already knows
 * exactly which step is next and which are finished -- but that lived only in
 * the transcript, so the board never showed the plan and never showed it being
 * worked off. Asked for directly: the steps an agent means to do should be on
 * the board "van tasks die gedaan moeten worden tot die gedaan zijn".
 *
 * This runs as a `PostToolUse` hook -- for Claude Code on `matcher: "TodoWrite"`,
 * for Codex on `matcher: "update_plan"`. Both were verified against their own
 * upstreams rather than assumed alike: code.claude.com/docs/en/hooks.md, and
 * openai/codex's own `PostToolUseCommandInput` (codex-rs/hooks/src/schema.rs).
 * They agree on the part that matters -- `tool_name`, `tool_input` and the
 * session's `cwd` arrive on stdin, and the matcher is an exact tool-name match --
 * so one script serves both.
 *
 * Gemini CLI (and Qwen Code, its fork) have one too: `write_todos`, on the
 * `AfterTool` event -- not `PostToolUse`, which is what several third-party
 * guides claim and what the official reference disproves.
 *
 * Where they differ is only the shape of the plan itself, and it is small:
 * Claude Code sends `tool_input.todos` with the step in `content`, Codex sends
 * `tool_input.plan` with it in `step` (codex_protocol::plan_tool::UpdatePlanArgs,
 * read from source, not guessed), Gemini sends `tool_input.todos` with it in
 * `description` (docs/tools/todos.md). They agree on pending / in_progress /
 * completed, so the mapping below is genuinely shared; Gemini adds two of its
 * own, handled just under it.
 *
 * This matters more than a convenience: without it, Codex only reaches the board
 * if the model remembers to call `sync_plan`. With it, the harness does it.
 *
 * Deliberately conservative:
 *  - One board item per distinct step, matched on its text, so revising a plan
 *    updates the same items instead of stacking duplicates.
 *  - A finished step becomes `works`, never `done` and never verified: the agent
 *    saying it did something is a claim, and confirming it stays the user's.
 *  - Steps are never deleted when they leave the agent's list. The plan is the
 *    agent's working memory; the board is the record.
 *  - But a step is never left `wip` with nobody on it. "In progress" on the board
 *    has to mean an agent is working it, and two things used to break that: a
 *    step that dropped out of the agent's plan while in progress (reworded,
 *    merged, abandoned) stayed `wip` forever, and so did every in-progress step
 *    of a session that ended mid-task. Reported as items sitting "in behandeling"
 *    that nobody ever picked up. So each synced step remembers the session whose
 *    plan holds it (`plan_owner`), and when that plan lets go of it -- the step
 *    leaves the list, or the session ends (`SessionEnd`) -- it goes back to
 *    `todo` with a note saying so. Still on the board, honestly open, and the
 *    next agent's `get_board` shows it as work to pick up.
 *  - Only the plan tools' own payloads release anything. TodoWrite, update_plan
 *    and write_todos always carry the WHOLE list, so a step missing from one has
 *    genuinely left the plan. Without a session id there is no owner to compare,
 *    and nothing is released.
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
/**
 * A step's identity: case, punctuation, spacing and accents do not make a new
 * step. The same rule the MCP server and the IDE use, so a plan written through
 * any of them lands on the same item -- a reworded "Run the tests." used to
 * become a second card and strand the first one in `wip`. Letters of every
 * script count, so a plan written in Chinese or Greek does not collapse to "".
 */
const norm = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
/** Same step? An empty key (a title that is only punctuation) never matches another. */
const sameStep = (a, b) => {
  const ka = norm(a)
  return ka !== '' && ka === norm(b)
}

/** The agents' todo states, mapped onto the board's columns. */
const STATUS = {
  pending: 'todo',
  in_progress: 'wip',
  completed: 'works',
  // Gemini CLI's two extras. `blocked` is a column the board already has.
  blocked: 'blocked'
}

/**
 * Gemini's `cancelled` is deliberately not in that map, and not a fallback to
 * `todo` either: the board has no cancelled column, and showing a step the agent
 * abandoned as outstanding work is worse than not showing it. A cancelled step
 * is skipped -- a new one never appears, an existing one keeps whatever the user
 * last saw, and nothing is ever deleted from under them.
 */
const SKIP_STATUS = new Set(['cancelled'])

/** The plan tools we mirror, per agent. */
const PLAN_TOOLS = new Set(['TodoWrite', 'update_plan', 'write_todos'])

/** A step's text, tolerating the field names different agents may use. */
function textOf(todo) {
  if (typeof todo === 'string') return todo
  for (const k of ['content', 'step', 'text', 'title', 'task', 'activeForm', 'description']) {
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

/**
 * Let go of an in-progress step whose plan no longer holds it: back to `todo`,
 * with a dated note, so the board stops claiming someone is on it.
 */
function release(item, why) {
  item.status = 'todo'
  item.updated_at = nowIso()
  delete item.plan_owner
  const line = `[${nowIso().slice(0, 16).replace('T', ' ')}] ${why}`
  item.notes = item.notes ? `${item.notes}\n${line}` : line
}

function logActivity(state, kind, text, who) {
  state.activity.unshift({ id: newId('a_'), at: nowIso(), kind, text, who: who || 'agent' })
  if (state.activity.length > 500) state.activity.length = 500
}

async function main() {
  const raw = readStdin()
  if (!raw.trim()) return
  const payload = JSON.parse(raw)
  // The session's own id (Claude Code's `session_id`; the other hosts send the
  // same field when they have one). It owns every step this session's plan puts
  // on the board. Without it there is nothing to compare, so nothing is released.
  const owner = typeof payload.session_id === 'string' ? payload.session_id.trim() : ''

  // The session is over: whatever its plan still had in progress, nobody is on.
  if (payload.hook_event_name === 'SessionEnd') {
    if (!owner) return
    const project = resolveProject(payload.cwd)
    if (!project || !existsSync(join(project, '.planide', 'state.json'))) return
    const state = loadState(project)
    const before = JSON.parse(JSON.stringify({ items: state.items, fixes: state.fixes ?? [], milestones: state.milestones ?? [], version: state.version }))
    let released = 0
    for (const item of state.items) {
      if (item.plan_owner !== owner) continue
      if (item.status === 'wip' && !item.locked) {
        release(item, `The session working on this ended${payload.reason ? ` (${payload.reason})` : ''} before it was finished.`)
        released += 1
      } else {
        delete item.plan_owner
      }
    }
    if (!released) return
    logActivity(state, 'plan-release', `session ended: ${released} unfinished step(s) back to todo`, 'agent')
    saveState(project, state)
    await recordHistory(project, before, state, 'agent')
    return
  }

  // The matcher should already have narrowed this, but a config edited by hand
  // could widen it, and syncing a Bash call as a plan would be nonsense.
  if (payload.tool_name && !PLAN_TOOLS.has(payload.tool_name)) return

  // `todos` is Claude Code's key, `plan` is Codex's. Whichever arrives is the plan.
  const input = payload?.tool_input ?? {}
  const todos = Array.isArray(input.todos) ? input.todos : input.plan
  if (!Array.isArray(todos) || todos.length === 0) return

  const project = resolveProject(payload.cwd)
  if (!project) return

  const agent = String(payload.agent_type || 'agent').slice(0, 40)
  const state = loadState(project)
  const before = JSON.parse(JSON.stringify({ items: state.items, fixes: state.fixes ?? [], milestones: state.milestones ?? [], version: state.version }))

  let added = 0
  let moved = 0
  let released = 0
  let owned = 0
  // The steps this plan still holds. A cancelled step is one it let go of on
  // purpose, so it counts as gone -- in progress when cancelled is still not
  // being worked.
  const planned = todos.filter((t) => !SKIP_STATUS.has(String(t?.status || ''))).map(textOf).filter(Boolean)
  const cancelled = todos.filter((t) => SKIP_STATUS.has(String(t?.status || ''))).map(textOf).filter(Boolean)
  for (const todo of todos) {
    const title = textOf(todo)
    if (!title) continue
    const raw = String(todo?.status || 'pending')
    if (SKIP_STATUS.has(raw)) continue
    const status = STATUS[raw] ?? 'todo'
    const item = state.items.find((i) => sameStep(i.title, title))
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
        locked_at: '',
        ...(owner ? { plan_owner: owner } : {})
      })
      added += 1
      continue
    }
    // A step the user has protected is theirs; never move it from a plan.
    if (item.locked) continue
    if (owner && item.plan_owner !== owner) {
      item.plan_owner = owner
      owned += 1
    }
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

  // What this session's plan held last time and has now let go of. A step it
  // finished or never started stays exactly as it is; one it left IN PROGRESS
  // would otherwise claim an agent is on it, forever.
  if (owner) {
    for (const item of state.items) {
      if (item.plan_owner !== owner) continue
      if (planned.some((t) => sameStep(item.title, t))) continue
      if (item.status === 'wip' && !item.locked) {
        const why = cancelled.some((t) => sameStep(item.title, t))
          ? `${agent} cancelled this step while it was in progress.`
          : `Left ${agent}'s plan while still in progress -- not finished.`
        release(item, why)
        released += 1
      } else {
        delete item.plan_owner
        owned += 1
      }
    }
  }

  // Ownership alone is worth a write: it is what lets the NEXT plan release a
  // step. Only real board changes are worth a line in the activity trail.
  if (!added && !moved && !released && !owned) return
  if (added || moved || released) {
    const tail = released ? `, ${released} released` : ''
    logActivity(state, 'plan-sync', `plan: ${added} new step(s), ${moved} moved${tail}`, agent)
  }
  saveState(project, state)
  await recordHistory(project, before, state, agent)
}

/** The durable record, so the plan's history survives the board's 500-line cap. */
async function recordHistory(project, before, state, agent) {
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
