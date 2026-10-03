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
 *    updates the same items instead of stacking duplicates. The match itself
 *    lives in tracker/mcp/work-queue.mjs, shared with sync_plan: two private
 *    copies drifted once ("Write tests." and "Write tests" became two rows).
 *  - A step already closed out to `done` stays `done`. Agents re-send finished
 *    steps on every plan change, and "completed" maps to `works` -- which used
 *    to drop `done` back to `works` and wipe the user's confirmation with it.
 *  - A finished step becomes `done` while the user's auto-complete is on (the
 *    default: "wat werkt mag als afgerond zijn"), `works` when it is off. Never
 *    verified either way: the agent saying it did something is its claim, and
 *    the "confirmed by you" count stays the user's own checks.
 *  - A step the plan drops goes off the board only if this same plan put it
 *    there and it is still open (work-queue.mjs retireDroppedSteps). Before
 *    0.99 nothing ever left, and every re-worded or abandoned step stayed todo
 *    or wip for good -- "todo gaat nooit omlaag". A row that was on the board
 *    first, finished work, and anything the user touched all stay.
 *  - Every failure is swallowed. A hook that throws would surface as a tool
 *    error to the agent mid-task, and a tracker problem must never do that.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const newId = (p) => p + randomUUID().replace(/-/g, '').slice(0, 12)

/**
 * The shared step match, from the deployed tracker beside this hook
 * (<config>/hooks and <config>/tracker are siblings, as they are in the repo).
 * Loaded, not bundled, so there is one definition -- and if it is ever missing
 * the hook does nothing rather than write the board with a match of its own.
 */
async function loadQueue() {
  const here = dirname(fileURLToPath(import.meta.url))
  return import(pathToFileURL(join(here, '..', 'tracker', 'mcp', 'work-queue.mjs')).href)
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

/**
 * Who wrote the plan, for the board's "by" column. Only Claude Code sends an
 * `agent_type`, and only inside a subagent; everything else used to land as
 * "agent", so a board worked by three CLIs could not say which did what.
 */
function agentName(payload) {
  if (typeof payload.agent_type === 'string' && payload.agent_type.trim()) return payload.agent_type.trim()
  if (payload.tool_name === 'TodoWrite') return 'Claude Code'
  if (payload.tool_name === 'update_plan') return 'Codex'
  if (payload.tool_name === 'write_todos') {
    return /[\\/]\.qwen[\\/]/.test(String(payload.transcript_path || '')) ? 'Qwen Code' : 'Gemini CLI'
  }
  return 'agent'
}

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

function logActivity(state, kind, text, who) {
  state.activity.unshift({ id: newId('a_'), at: nowIso(), kind, text, who: who || 'agent' })
  if (state.activity.length > 500) state.activity.length = 500
}

async function main() {
  const raw = readStdin()
  if (!raw.trim()) return
  const payload = JSON.parse(raw)
  // The matcher should already have narrowed this, but a config edited by hand
  // could widen it, and syncing a Bash call as a plan would be nonsense.
  if (payload.tool_name && !PLAN_TOOLS.has(payload.tool_name)) return

  // `todos` is Claude Code's key, `plan` is Codex's. Whichever arrives is the plan.
  const input = payload?.tool_input ?? {}
  const todos = Array.isArray(input.todos) ? input.todos : input.plan
  if (!Array.isArray(todos) || todos.length === 0) return

  const project = resolveProject(payload.cwd)
  if (!project) return

  const queue = await loadQueue()
  const { finishedStatus, closeOutWorking, applyPlan, planKey, boardMark } = queue
  const agent = agentName(payload).slice(0, 40)
  const state = loadState(project)
  const before = JSON.parse(JSON.stringify({ items: state.items, fixes: state.fixes ?? [], milestones: state.milestones ?? [], version: state.version }))
  const markBefore = boardMark(state)

  const steps = []
  for (const todo of todos) {
    const title = textOf(todo)
    if (!title) continue
    const raw = String(todo?.status || 'pending')
    if (SKIP_STATUS.has(raw)) continue
    // With the user's auto-complete on, a finished step lands as `done`.
    steps.push({ title, status: finishedStatus(state, STATUS[raw] ?? 'todo') })
  }
  // One plan = one session's main agent, or one subagent inside it.
  const session = typeof payload.session_id === 'string' ? payload.session_id : ''
  const key = planKey(session, payload.agent_id)
  const { added, moved, retired, active } = applyPlan(state, steps, { agent, key, now: nowIso(), newId: () => newId('i_') })

  // Anything an agent left in `works` before (an older hook, another route) is
  // closed out in this same write when auto-complete is on.
  const closed = closeOutWorking(state, nowIso())
  if (!added && !moved && !retired.length && !closed.length) return
  if (added || moved || retired.length) {
    const gone = retired.length ? `, ${retired.length} dropped from the plan (${retired.map((i) => i.title).slice(0, 3).join('; ')})` : ''
    logActivity(state, 'plan-sync', `plan: ${added} new step(s), ${moved} moved${gone}`, agent)
  }
  if (closed.length) logActivity(state, 'auto-complete', `closed out ${closed.length} working item(s)`, 'auto')
  saveState(project, state)

  // This session worked the board this turn -- what lets the autopilot hook
  // hand it the next item when it stops (hooks/keep-going.mjs). Keyed by the
  // session alone: a subagent's plan is part of its parent's turn.
  if (session) {
    try {
      const { updateSession } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'tracker', 'mcp', 'sessions.mjs')).href)
      updateSession(project, session, (rec) => ({
        ...(rec ?? { mark: markBefore, drive: false, pushes: 0 }),
        worked: true,
        // The step the main agent's plan is on is this chat's own item -- what
        // "ga door" after a quota wait resumes. A subagent's step is its own.
        ...(active.length && !payload.agent_id ? { current: active[0] } : {})
      }))
    } catch {
      /* the autopilot loses one turn; the board write already happened */
    }
  }

  // The durable record, so the plan's history survives the board's 500-line cap.
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const { recordDiff } = await import(pathToFileURL(join(here, '..', 'tracker', 'mcp', 'history-db.mjs')).href)
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
