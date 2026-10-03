#!/usr/bin/env node
/**
 * PlanIDE tracker MCP server — zero dependencies, no Python.
 *
 * This exists because the Python server it replaces could not run on a normal
 * machine: it needs Python *and* `fastmcp`, and without them it exits
 * immediately — so the agent silently had no tracker tools at all and the board
 * stayed empty no matter what the user asked for. That was the actual reason
 * "de tracker doet helemaal niets in geen één agent".
 *
 * This one is plain Node with no imports beyond `node:` builtins, so it runs
 * under the app's own Electron binary (ELECTRON_RUN_AS_NODE=1) — which is always
 * present, because it *is* the IDE. Nothing to install, nothing to provision.
 *
 * Transport: MCP stdio — newline-delimited JSON-RPC 2.0 on stdin/stdout.
 * Nothing may ever be written to stdout except protocol frames (a stray print
 * corrupts the stream), so all logging goes to stderr.
 *
 * It reads and writes the same `<project>/.planide/state.json` the IDE's own
 * tracker uses, so an agent's updates show up live in the Tracker tab.
 * `ide/test/mcp-node.test.mjs` asserts that shape stays in step with store.ts.
 *
 * Trust boundary, identical to the IDE's: an agent can add and move items, log
 * and close fixes, and cut versions. Reporting `works`/`done` confirms an item
 * (attributed to the agent, so you can decline it) -- but it can NEVER set
 * `locked`. Those are the user's alone, so an agent cannot confirm its own work
 * or unprotect what it is about to change.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
// The work order and the shared title match. A sibling in this same directory,
// deployed with it -- the todo-sync and resume-brief hooks import it too, so
// "is this the same step" and "what comes next" have one answer, not three.
import {
  applyPlan, autoComplete, autopilot, closeOutWorking, findOpenFix, finishedStatus, nextUp, sameTitle, wipHeldBy, workQueue
} from './work-queue.mjs'
// Loose docs into docs/ -- the same sweep the session hooks run, here for the
// agents that have no hooks (Antigravity, Cursor, opencode) and call get_board first.
import { sweepDocs, sweepNote } from './docs-tidy.mjs'

/**
 * This server process is one agent session: every CLI starts its own stdio
 * server and talks to it alone. So a plan sent through sync_plan is owned by
 * this process (and the agent name it gives, which tells a dispatched subagent
 * from its parent) -- the key that lets a later plan from the same session take
 * the steps it dropped back off the board. See applyPlan in work-queue.mjs.
 */
const PROCESS_PLAN = `mcp-${process.pid}-${randomUUID().slice(0, 8)}`

const SERVER_NAME = 'planide'
const SERVER_VERSION = '2.0.0'
/** Spoken if the client does not name one. Echoing the client's is preferred. */
const FALLBACK_PROTOCOL = '2026-06-18'

/**
 * Who is at the keyboard, for the history log. Set from the MCP client's own
 * name at `initialize` (Claude Code, Codex, Cursor, ... each send one); left as
 * a plain 'agent' when a client does not identify itself. Never affects the
 * board -- it is only the `actor` column of the per-project history DB.
 */
let CLIENT_ACTOR = 'agent'

/**
 * The per-project history recorder, loaded lazily and defensively.
 *
 * It lives in a sibling module that imports `node:sqlite`. If that module is
 * ever missing from a deploy, or this app's Node lacks `node:sqlite`, the import
 * simply fails and history is skipped -- it must never stop the tracker itself
 * from working, which is the whole board. A static import could not offer that
 * guarantee: a missing sibling would break the server on load. So it is a
 * dynamic import, tried once, and every call is fire-and-forget and swallowed.
 * `undefined` = not yet tried, `null` = tried and unavailable, function = ready.
 */
let _recordDiff
async function recordHistorySafe(path, before, after, actor) {
  try {
    if (_recordDiff === undefined) {
      try {
        _recordDiff = (await import('./history-db.mjs')).recordDiff
      } catch {
        _recordDiff = null
      }
    }
    if (_recordDiff) _recordDiff(path, before, after, actor)
  } catch {
    /* history is best-effort memory; never let it affect the board */
  }
}

const ITEM_STATUSES = ['todo', 'wip', 'works', 'broken', 'blocked', 'done']
const FIX_STATUSES = ['open', 'fixed', 'wontfix']

// --------------------------------------------------------------------------- state
// Mirrors src/main/planide/store.ts. Kept deliberately literal rather than
// clever, so a diff against that file is easy to eyeball.

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const newId = (prefix) => prefix + randomUUID().replace(/-/g, '').slice(0, 12)

const statePath = (projectPath) => join(projectPath, '.planide', 'state.json')

function blankState(projectPath) {
  return {
    id: newId('p_'),
    name: basename(projectPath.replace(/[/\\]+$/, '')) || 'project',
    path: projectPath,
    type: 'custom',
    stack: { detected: {}, custom: '' },
    version: '0.1.0',
    created_at: nowIso(),
    updated_at: nowIso(),
    items: [],
    fixes: [],
    roadmap: [],
    versions: [],
    github: { remote: '', branch: 'main', lfs: false, auto_push: false, last_sync: '' },
    backups: [],
    activity: [],
    // The user's switches. auto_complete: work that works counts as finished.
    settings: { auto_complete: true }
  }
}

/** Read a project's board, creating it if this is the first thing to touch it. */
function loadState(projectPath) {
  let state
  try {
    state = JSON.parse(readFileSync(statePath(projectPath), 'utf8'))
  } catch {
    return blankState(projectPath)
  }
  // Forward-compat, same as the IDE: fill anything an older writer omitted.
  const blank = blankState(projectPath)
  for (const [k, v] of Object.entries(blank)) if (state[k] === undefined) state[k] = v
  state.path = projectPath
  for (const item of state.items ?? []) {
    item.claimed_by ??= ''
    item.verified ??= false
    item.verified_at ??= ''
    item.verified_by ??= ''
    item.locked ??= false
    item.locked_at ??= ''
    item.tags ??= []
    item.notes ??= ''
  }
  // A fix with no status was logged by an IDE whose addFix dropped the default
  // (store.ts): it was meant to be open, so it is. Same repair as store.ts.
  for (const fix of state.fixes ?? []) {
    if (!FIX_STATUSES.includes(fix.status)) fix.status = 'open'
  }
  return state
}

function saveState(projectPath, state) {
  state.updated_at = nowIso()
  mkdirSync(join(projectPath, '.planide'), { recursive: true })
  const file = statePath(projectPath)
  // Write-then-rename so a crash mid-write cannot truncate the board.
  //
  // The temp name carries this process's pid ON PURPOSE. The IDE and an agent's
  // MCP server both write this file, by design and at the same time -- that is
  // the whole point of a live board. With a shared `state.json.tmp` they share
  // an inode: one can truncate the other's half-written temp, or rename it away
  // while the other still holds it open, at which point the loser's remaining
  // writes land inside the live board. A pid-unique name means the two never
  // touch the same temp, and rename stays atomic.
  const tmp = `${file}.${process.pid}.tmp`
  // Clean up after a failed rename. On Windows an AV scanner or the search
  // indexer can hold the target just long enough for renameSync to throw, and
  // the old shape left the temp behind -- with a pid in its name, so a new one
  // accumulated per process rather than overwriting the last. The write still
  // fails loudly; it just does not litter.
  try {
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* best effort -- the original error is what matters */
    }
    throw err
  }
}

function logActivity(state, kind, text, who = 'agent') {
  state.activity ??= []
  state.activity.unshift({ id: newId('a_'), at: nowIso(), kind, text, who: who || 'agent' })
  if (state.activity.length > 500) state.activity.length = 500
}

function progress(state) {
  const items = state.items ?? []
  const counts = {}
  for (const s of ITEM_STATUSES) counts[s] = items.filter((i) => i.status === s).length
  // Only YOUR confirmation counts as confirmed, never an agent's. set_item
  // stamps verified_by with the agent's name when it reports works/done, so a
  // bare `verified` check would read every agent claim as your check -- the
  // exact split this board exists to keep. verified && no verified_by == you.
  const workingItems = items.filter((i) => i.status === 'works' || i.status === 'done')
  const working = workingItems.length
  const confirmed = workingItems.filter((i) => i.verified && !i.verified_by).length
  // With auto-complete on (the user's switch) everything that works counts as
  // finished -- that is what "accepted" is. Off, only the user's own checks
  // count. `confirmed` stays the user's checks either way. Same as store.ts.
  const auto = autoComplete(state)
  const accepted = auto ? working : confirmed
  return {
    total_items: items.length,
    counts,
    confirmed,
    auto_complete: auto,
    accepted,
    accepted_percent: items.length ? Math.round((accepted / items.length) * 100) : 0,
    by_agents: workingItems.filter((i) => !(i.verified && !i.verified_by) && (i.claimed_by || i.verified_by)).length,
    unconfirmed: working - accepted,
    open: counts.todo + counts.wip,
    broken: counts.broken,
    protected: items.filter((i) => i.locked).length,
    regressed: items.filter((i) => i.locked && i.status === 'broken').length,
    percent: items.length ? Math.round((working / items.length) * 100) : 0,
    confirmed_percent: items.length ? Math.round((confirmed / items.length) * 100) : 0,
    open_fixes: (state.fixes ?? []).filter((f) => f.status === 'open').length,
    version: state.version
  }
}

// --------------------------------------------------------------------------- helpers

// A directory that carries one of these is a real project, not a stray cwd.
// Used only for the fallback below, never to reject an explicit `project`.
const PROJECT_MARKERS = ['.planide', '.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', '.hg', '.svn']

/**
 * Resolve + validate the `project` argument every tool takes.
 *
 * The tools ask for `project` and the schema marks it required, so a
 * well-behaved agent always sends it. But agents forget, and until now a
 * missing `project` threw — which the model saw as a tool error and, often,
 * simply moved on from, so the board silently never moved. That is exactly the
 * "agents write nothing to the tracker" report, and it needs no reproduction to
 * be worth closing: a forgotten argument should not lose the write.
 *
 * The fallback is the agent's own working directory. Claude Code and Codex spawn
 * a stdio MCP server as a child of the agent, which inherits the agent's cwd,
 * and for a task run in the IDE's terminal that cwd IS the project. Two guards
 * keep a stray cwd from scattering a `.planide` where it does not belong: never
 * the home directory, and only a directory that actually looks like a project.
 */
function resolveProject(args) {
  const raw = typeof args?.project === 'string' ? args.project.trim() : ''
  let path
  if (raw) {
    path = isAbsolute(raw) ? raw : resolve(raw)
  } else {
    const cwd = process.cwd()
    const isHome = resolve(cwd) === resolve(homedir())
    const looksLikeProject = !isHome && PROJECT_MARKERS.some((m) => existsSync(join(cwd, m)))
    if (!looksLikeProject) {
      throw new Error('project is required: pass the absolute path of the project directory')
    }
    process.stderr.write(`[planide-mcp] no project argument given; defaulting to cwd ${cwd}\n`)
    path = cwd
  }
  if (!existsSync(path)) throw new Error(`project path does not exist: ${path}`)
  return path
}

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])

/** Read board, apply fn, write board. Every mutating tool goes through here. */
/**
 * A plan step's state, in whichever vocabulary the caller has.
 *
 * Claude Code's TodoWrite says pending/in_progress/completed; the board says
 * todo/wip/works. Agents that reach this through the MCP rather than the hook
 * will send either, and rejecting one of them would just mean plans silently
 * not syncing for whichever agent guessed differently. Same mapping the
 * todo-sync hook uses, so both routes land a plan in the same place.
 */
const PLAN_STATUS = { pending: 'todo', in_progress: 'wip', completed: 'works' }

function planStatus(value) {
  const raw = String(value || 'pending').trim().toLowerCase()
  if (ITEM_STATUSES.includes(raw)) return raw
  return PLAN_STATUS[raw] ?? 'todo'
}

function mutate(path, fn) {
  const state = loadState(path)
  // A deep snapshot of just the collections history diffs, taken before `fn`
  // mutates them in place, so the diff below sees a real before/after. Only
  // these four -- cloning the whole board every write would be wasteful and
  // history does not track the rest.
  const before = {
    items: structuredClone(state.items ?? []),
    fixes: structuredClone(state.fixes ?? []),
    milestones: structuredClone(state.milestones ?? []),
    version: state.version
  }
  const result = fn(state)
  // Whatever this write left in `works` from an agent is closed out in the same
  // write when the user has auto-complete on -- so the board never needs anyone
  // to go round moving finished work to done.
  const closed = closeOutWorking(state, nowIso())
  if (closed.length) {
    logActivity(state, 'auto-complete', `closed out ${closed.length} working item(s): ${closed.map((i) => i.title).slice(0, 3).join(', ')}${closed.length > 3 ? ', ...' : ''}`, 'auto')
  }
  saveState(path, state)
  // Best-effort, and only after the board is safely written: the history DB is
  // memory, not the ledger, so a failure here must never cost the board update.
  // Fire-and-forget -- not awaited, and it cannot throw into this path.
  void recordHistorySafe(path, before, state, CLIENT_ACTOR)
  return result
}

const lower = (v) => String(v ?? '').trim().toLowerCase()

/** The "you are already on something" warning, for add_item/set_item to wip. */
function finishFirst(held) {
  const list = held.map((i) => `"${i.title}" [${i.id}]`).join(', ')
  return (
    `You already have ${list} in progress. Finish it first (set_item works/done), ` +
    'or set it back to todo if you are really switching -- the board keeps one thing in hand at a time.'
  )
}

/**
 * What add_fix tells the agent after logging: where the bug went, and what to
 * stay on. The rule it enforces is the user's: a bug found mid-task goes to
 * Fixes > Open and is picked up later, it does not derail the work in hand.
 */
function stayOn(state, agent) {
  const q = workQueue(state, { agent })
  const f = q.focus
  if (!f || f.lane === 'fix' || f.lane === 'broken') {
    return { next: 'Logged in Fixes > Open. Nothing is in progress or todo, so the fix queue is next -- call next_task.' }
  }
  return {
    next:
      `Logged in Fixes > Open for later. Stay on "${f.title}" [${f.id}] -- ` +
      'open fixes are picked up after the todo list (next_task tells you when).'
  }
}

/** The part of the queue get_board carries: enough to resume, not the whole thing. */
function queueSummary(q) {
  return {
    phase: q.phase,
    focus: q.focus ? { lane: q.focus.lane, id: q.focus.id, title: q.focus.title, action: q.focus.action } : null,
    counts: q.counts,
    ...(q.alerts.length ? { alerts: q.alerts } : {}),
    order: q.order
  }
}

// --------------------------------------------------------------------------- tools

const P = (extra = {}) => ({
  project: { type: 'string', description: 'Absolute project path.' },
  ...extra
})


// --------------------------------------------------------------------------- doc hygiene
// Layer-A AI provenance marks: characters that carry no visible meaning but do
// carry a watermark -- zero-width, bidirectional controls, Unicode tag
// characters (an entire hidden payload fits in U+E0000..U+E007F), and lookalike
// spaces. Modelled on guillaumemeyer/watermarks-remover (MIT).
//
// Kept deliberately in step with src/main/planide/doc-clean.ts: this server is
// standalone by design (no imports out of the bundle), so the patterns are
// duplicated rather than shared. Change one, change the other.
const MARKS = [
  ['zeroWidth', /[\u200B-\u200D\u2060\uFEFF]/g, ''],
  ['bidi', /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ''],
  ['tags', /[\u{E0000}-\u{E007F}]/gu, ''],
  ['invisible', /[\u00AD\u034F\u061C\u180E\u2061-\u2064]/g, ''],
  ['oddSpaces', /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ']
]

function cleanMarks(text) {
  const removed = {}
  let out = text
  let total = 0
  for (const [name, re, sub] of MARKS) {
    const hits = text.match(re)
    const n = hits ? hits.length : 0
    removed[name] = n
    total += n
    out = out.replace(re, sub)
  }
  return { cleaned: out, removed, total, changed: out !== text }
}

const TOOLS = [
  {
    name: 'get_board',
    description:
      'The whole board: items, fixes, roadmap, progress, and `next` (where to resume). Call first.',
    inputSchema: {
      type: 'object',
      properties: P({ agent: { type: 'string', description: 'Your name.' } }),
      required: ['project']
    },
    run: (args) => {
      const path = resolveProject(args)
      let docs = ''
      try {
        docs = sweepNote(sweepDocs(path))
      } catch {
        docs = ''
      }
      const state = loadState(path)
      // Read-only: show the board as the next write will store it.
      closeOutWorking(state, nowIso())
      return {
        ...(docs ? { docs } : {}),
        project: state.name,
        path,
        version: state.version,
        progress: progress(state),
        next: queueSummary(workQueue(state, { agent: str(args.agent) })),
        items: (state.items ?? []).map((i) => ({
          id: i.id, title: i.title, status: i.status, notes: i.notes,
          verified: i.verified, locked: i.locked, claimed_by: i.claimed_by
        })),
        fixes: (state.fixes ?? []).map((f) => ({
          id: f.id, title: f.title, status: f.status, problem: f.problem, solution: f.solution
        })),
        roadmap: (state.roadmap ?? []).map((m) => ({
          id: m.id, title: m.title, target: m.target, done: m.done
        })),
        recent_activity: (state.activity ?? []).slice(0, 15)
      }
    }
  },
  {
    name: 'next_task',
    description:
      "What to do now, in order: finish wip (also left-over), then todo, then open fixes. Call on start, on resume, and after each finished piece. claim=true starts the next todo as yours.",
    inputSchema: {
      type: 'object',
      properties: P({
        agent: { type: 'string', description: 'Your name; work another agent is on is skipped.' },
        claim: { type: 'boolean' },
        limit: { type: 'integer', description: 'Per lane, default 5.' }
      }),
      required: ['project']
    },
    run: (args) => {
      const path = resolveProject(args)
      const agent = str(args.agent).slice(0, 40)
      const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : undefined
      const peek = workQueue(loadState(path), { agent, limit })
      // Only two things are claimable, and only they are worth a write: a todo
      // being started, and a left-over wip changing hands. Everything else --
      // your own wip, a fix, a protected item, nothing at all -- is read-only,
      // so a peek never churns the board file the IDE is watching.
      const claimable = (f) =>
        f?.kind === 'item' &&
        !f.locked &&
        (f.lane === 'todo' || (f.lane === 'in_progress' && Boolean(agent) && lower(f.claimed_by) !== lower(agent)))
      if (args.claim !== true || !claimable(peek.focus)) {
        const f = peek.focus
        const why = !f
          ? 'The board has nothing open.'
          : f.locked
            ? `"${f.title}" is protected. Ask the user before you touch it.`
            : 'Nothing to claim: the focus is already yours or is a fix -- work it as it stands.'
        return { project: path, ...(args.claim === true ? { claimed: null, note: why } : {}), ...peek }
      }
      return mutate(path, (state) => {
        // Decided again on the board as it is NOW, under the write: another
        // agent may have taken the same item between the peek and this call,
        // and handing it out twice is the duplication this exists to stop.
        const fresh = workQueue(state, { agent, limit })
        const f = fresh.focus
        const item = claimable(f) && f.id === peek.focus.id ? (state.items ?? []).find((i) => i.id === f.id) : null
        if (!item) {
          return { project: path, claimed: null, note: 'The board changed under you -- this is the queue as it stands now.', ...fresh }
        }
        const from = item.status
        const previous = item.claimed_by || ''
        if (from === 'todo') {
          item.status = 'wip'
          if (item.verified) {
            item.verified = false; item.verified_at = ''; item.verified_by = ''
          }
          logActivity(state, 'item-status', `${item.title} -> wip (picked up from the queue)`, agent)
        } else {
          logActivity(
            state,
            'item-claim',
            previous ? `${item.title}: taken over from ${previous} (left over)` : `${item.title}: picked up (nobody was on it)`,
            agent
          )
        }
        if (agent) item.claimed_by = agent
        item.updated_at = nowIso()
        return {
          project: path,
          claimed: { id: item.id, title: item.title, from, to: item.status, ...(from !== 'todo' ? { taken_over_from: previous } : {}) },
          ...workQueue(state, { agent, limit })
        }
      })
    }
  },
  {
    name: 'sync_plan',
    description:
      "Mirror your whole current plan onto the board: every step with its state. Matched on text, so re-sending moves steps instead of duplicating. Call whenever the plan changes.",
    inputSchema: {
      type: 'object',
      properties: P({
        todos: {
          type: 'array',
          description: 'Every step, in order.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'The step, as one line.' },
              status: {
                type: 'string',
                description: 'pending/in_progress/completed, or todo/wip/works/done/broken/blocked.'
              }
            },
            required: ['content']
          }
        },
        agent: { type: 'string' }
      }),
      required: ['project', 'todos']
    },
    run: (args) => {
      const path = resolveProject(args)
      // Not arr(): that keeps strings only, and a plan step is an object.
      // Both shapes are accepted -- an agent sending a bare list of lines is
      // giving us a plan too, just without states.
      const todos = Array.isArray(args.todos) ? args.todos : []
      if (!todos.length) throw new Error('todos is required and must not be empty')
      const agent = str(args.agent, 'agent').slice(0, 40)
      return mutate(path, (state) => {
        const steps = []
        const skipped = []
        for (const todo of todos) {
          const title = String(
            typeof todo === 'string'
              ? todo
              : (todo &&
                  // `step` is what Codex's own update_plan calls it. The rest are
                  // the names other agents reach for. An alias costs nothing; a
                  // plan silently not landing costs the whole feature.
                  (todo.content ?? todo.step ?? todo.title ?? todo.text ?? todo.task ?? todo.description)) ||
                ''
          ).trim()
          if (!title) {
            skipped.push(todo)
            continue
          }
          steps.push({ title, status: finishedStatus(state, planStatus(typeof todo === 'string' ? '' : todo && todo.status)) })
        }
        // The one plan writer, shared with the todo-sync hook (work-queue.mjs):
        // both match a step the same way, neither drops a `done` item back to
        // `works` nor moves a protected one -- and both take back off the board
        // the open steps this same plan put there and has now dropped.
        const { added, moved, retired } = applyPlan(state, steps, {
          agent,
          key: `${PROCESS_PLAN}:${agent.toLowerCase()}`,
          now: nowIso(),
          newId: () => newId('i_')
        })
        if (added || moved || retired.length) {
          const gone = retired.length ? `, ${retired.length} dropped from the plan` : ''
          logActivity(state, 'plan-sync', `plan: ${added} new step(s), ${moved} moved${gone}`, agent)
        }
        // A step we could not read is not a success. Returning {added: 0, moved: 0}
        // and nothing else is how a plan fails to reach the board while the agent
        // is told it worked -- which reads to the user as "the tracker is broken"
        // with nothing anywhere to say so.
        if (!skipped.length) return { added, moved, total: todos.length, ...(retired.length ? { dropped: retired.length } : {}) }

        const shape = skipped
          .map((t) => (t && typeof t === 'object' ? Object.keys(t).join('+') || '{}' : typeof t))
          .slice(0, 3)
          .join(', ')
        const how =
          `Each step needs its text in \`content\` -- either a plain string or ` +
          '{ content, status }.'
        // Nothing landed: no partial work to protect, and staying quiet would be
        // the original bug. Throwing is the only answer the agent cannot miss.
        if (!added && !moved) {
          throw new Error(
            `None of the ${todos.length} step(s) had readable text, so the board did not ` +
              `change (got: ${shape}). ${how}`
          )
        }
        // Some landed. Throwing here would roll back the steps that were fine --
        // strictly worse than the silence it replaced -- so keep them and say
        // plainly what was dropped.
        return {
          added,
          moved,
          total: todos.length,
          skipped: skipped.length,
          warning: `${skipped.length} step(s) had no readable text and are NOT on the board (got: ${shape}). ${how}`
        }
      })
    }
  },
  {
    name: 'add_item',
    description:
      "Put work on the board: 'todo' when asked or planned, 'wip' when started. One item per real piece of work; the same open title returns the existing item.",
    inputSchema: {
      type: 'object',
      properties: P({
        title: { type: 'string' },
        status: { type: 'string', enum: ITEM_STATUSES },
        notes: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string' },
        agent: { type: 'string' }
      }),
      required: ['project', 'title']
    },
    run: (args) => {
      const path = resolveProject(args)
      const title = str(args.title).trim()
      if (!title) throw new Error('title is required')
      const asked = ITEM_STATUSES.includes(str(args.status)) ? args.status : 'todo'
      const agent = str(args.agent)
      return mutate(path, (state) => {
        const status = finishedStatus(state, asked)
        // Don't stack duplicates. Agents re-post their plan every turn, so the
        // same title arrives again and again; sync_plan already dedupes on the
        // normalised title, and add_item -- the tool agents call directly -- was
        // the one path that did not, quietly growing the board. Match an item
        // that is still OPEN; a title whose only match is already 'done' is
        // allowed through, because work can legitimately recur.
        const open = (state.items ?? []).find((i) => i.status !== 'done' && sameTitle(i.title, title))
        if (open) {
          return { id: open.id, title: open.title, status: open.status, existing: true }
        }
        const item = {
          id: newId('i_'), title, status,
          notes: str(args.notes), tags: arr(args.tags), priority: str(args.priority, 'normal'),
          created_at: nowIso(), updated_at: nowIso(),
          claimed_by: agent, verified: false, verified_at: '', verified_by: '',
          locked: false, locked_at: ''
        }
        state.items.push(item)
        logActivity(state, 'item-add', `added ${item.title} (${status})`, agent)
        const held = status === 'wip' ? wipHeldBy(state.items, agent, item.id) : []
        return {
          id: item.id, title: item.title, status: item.status,
          ...(held.length ? { warning: finishFirst(held) } : {})
        }
      })
    }
  },
  {
    name: 'set_item',
    description:
      "Move an item: 'wip' when you start, 'works' when it genuinely works (lands as 'done' with the user's auto-complete on, so run the project's checks first), 'broken' when it fails. Recorded under your name, never as the user's confirmation.",
    inputSchema: {
      type: 'object',
      properties: P({
        item_id: {
          type: 'string',
          description: 'i_... from add_item/get_board; `id` also works.'
        },
        id: { type: 'string' },
        status: { type: 'string', enum: ITEM_STATUSES },
        title: { type: 'string' },
        notes: { type: 'string' },
        agent: { type: 'string' }
      }),
      required: ['project']
    },
    run: (args) => {
      const path = resolveProject(args)
      // add_item returns `id`; get_board shows `id`. Agents naturally pass that
      // straight back, so accept the bare `id` as an alias for `item_id` (only
      // Antigravity, which has no plan-sync hook, ever depended on this working).
      const itemId = str(args.item_id) || str(args.id)
      if (!itemId) throw new Error('item_id is required (the item id from get_board / add_item)')
      return mutate(path, (state) => {
        const item = (state.items ?? []).find((i) => i.id === itemId)
        if (!item) throw new Error(`no item with id ${itemId} (call get_board for the real ids)`)
        const next = finishedStatus(state, str(args.status))
        const statusChanged = next && ITEM_STATUSES.includes(next) && next !== item.status
        // A status change drops the user's confirmation: what they confirmed is
        // no longer what the item says.
        if (statusChanged && item.verified) {
          item.verified = false; item.verified_at = ''; item.verified_by = ''
        }
        if (statusChanged) item.status = next
        // Reporting something working confirms it, attributed to this agent, so
        // the board goes green as work lands. The user can decline it in the IDE.
        // Must stay identical to store.ts's updateItem -- the parity test in
        // ide/test/mcp-node.test.mjs loads what we write with the real store and
        // compares, so the two cannot drift.
        if (statusChanged && (next === 'works' || next === 'done')) {
          // With auto-complete on, a report through this server is always an
          // agent's -- name the client when the call did not name itself.
          const reporter = str(args.agent) || item.claimed_by || (autoComplete(state) ? CLIENT_ACTOR : '')
          if (reporter) {
            item.verified = true
            item.verified_at = nowIso()
            item.verified_by = reporter
          }
        }
        if (typeof args.title === 'string') item.title = args.title
        if (typeof args.notes === 'string') item.notes = args.notes
        if (typeof args.agent === 'string') item.claimed_by = args.agent
        item.updated_at = nowIso()
        const who = str(args.agent)
        if (statusChanged) {
          const regression = item.locked && next === 'broken'
          logActivity(
            state,
            'item-status',
            regression ? `REGRESSION: ${item.title} is broken (protected)` : `${item.title} -> ${next}`,
            who
          )
        }
        const held = statusChanged && next === 'wip' ? wipHeldBy(state.items, who || item.claimed_by, item.id) : []
        // Finished or set aside: hand over the next item in the same answer.
        // This is the autopilot for an agent with no stop hook to do it --
        // Antigravity, Cursor, opencode -- and the user's switch governs it too.
        const closed = statusChanged && ['works', 'done', 'blocked'].includes(next)
        const then = closed && autopilot(state) ? nextUp(state, { agent: who }) : ''
        return {
          id: item.id, title: item.title, status: item.status,
          verified: item.verified, verified_by: item.verified_by,
          ...(held.length ? { warning: finishFirst(held) } : {}),
          ...(then ? { next: then } : {})
        }
      })
    }
  },
  {
    name: 'add_fix',
    description:
      'Log a bug you hit: what and where. It lands in Fixes > Open and waits its turn -- carry on with your current item. The same open bug returns the existing entry.',
    inputSchema: {
      type: 'object',
      properties: P({
        title: { type: 'string' },
        problem: { type: 'string' },
        solution: { type: 'string' },
        item_id: { type: 'string' },
        agent: { type: 'string' }
      }),
      required: ['project', 'title']
    },
    run: (args) => {
      const path = resolveProject(args)
      const title = str(args.title).trim()
      if (!title) throw new Error('title is required')
      const agent = str(args.agent)
      const status = FIX_STATUSES.includes(str(args.status)) ? args.status : 'open'
      return mutate(path, (state) => {
        // One bug, one entry. An agent that hits the same failure on three
        // turns logged it three times, and Fixes > Open became a list nobody
        // could walk. The same open bug returns the entry already there, and a
        // new detail about it is kept on that entry instead of a second row.
        const known = status === 'open' ? findOpenFix(state.fixes, title) : null
        if (known) {
          const problem = str(args.problem).trim()
          if (problem && !String(known.problem || '').includes(problem)) {
            known.problem = known.problem ? `${known.problem}\n${problem}` : problem
          }
          return { id: known.id, title: known.title, status: known.status, existing: true, ...stayOn(state, agent) }
        }
        const fix = {
          id: newId('f_'), title,
          problem: str(args.problem), solution: str(args.solution),
          item_id: str(args.item_id), agent, status,
          created_at: nowIso(), fixed_at: status === 'fixed' ? nowIso() : ''
        }
        state.fixes.push(fix)
        logActivity(state, 'fix-add', `logged fix: ${fix.title}`, agent)
        return {
          id: fix.id, title: fix.title, status: fix.status,
          ...(status === 'open' ? stayOn(state, agent) : {})
        }
      })
    }
  },
  {
    name: 'mark_fixed',
    description: 'Close a fix you verified (or the user says is solved), with the real solution.',
    inputSchema: {
      type: 'object',
      properties: P({
        fix_id: {
          type: 'string',
          description: 'f_... from add_fix/get_board; `id` also works.'
        },
        id: { type: 'string' },
        solution: { type: 'string', description: 'Cause and change.' },
        agent: { type: 'string' }
      }),
      required: ['project']
    },
    run: (args) => {
      const path = resolveProject(args)
      const fixId = str(args.fix_id) || str(args.id)
      if (!fixId) throw new Error('fix_id is required (the fix id from get_board / add_fix / next_task)')
      return mutate(path, (state) => {
        const fix = (state.fixes ?? []).find((f) => f.id === fixId)
        if (!fix) throw new Error(`no fix with id ${fixId} (call get_board for the real ids)`)
        fix.status = 'fixed'
        fix.fixed_at = nowIso()
        if (typeof args.solution === 'string' && args.solution.trim()) fix.solution = args.solution
        logActivity(state, 'fix-done', `fixed: ${fix.title}`, str(args.agent))
        // Closed with no solution records that a problem went away, not how --
        // the next agent to hit the same symptom starts from nothing. Still
        // closed (the user may simply have said "it works now"), but said out loud.
        const bare = !String(fix.solution || '').trim()
        const then = autopilot(state) ? nextUp(state, { agent: str(args.agent) }) : ''
        return {
          id: fix.id, title: fix.title, status: fix.status,
          ...(bare
            ? { warning: 'Closed with no solution. Call mark_fixed again with solution: the real cause and the real change, so the next agent does not re-derive it.' }
            : {}),
          ...(then ? { next: then } : {})
        }
      })
    }
  },
  {
    name: 'reopen_fix',
    description:
      'A closed fix came back (status open), or park one (wontfix). Use instead of logging a duplicate.',
    inputSchema: {
      type: 'object',
      properties: P({
        fix_id: {
          type: 'string',
          description: 'f_... from add_fix/get_board; `id` also works.'
        },
        id: { type: 'string' },
        status: { type: 'string', enum: ['open', 'wontfix'] },
        note: { type: 'string', description: 'Why; appended to the problem.' },
        agent: { type: 'string' }
      }),
      required: ['project']
    },
    run: (args) => {
      const path = resolveProject(args)
      const fixId = str(args.fix_id) || str(args.id)
      const status = FIX_STATUSES.includes(str(args.status)) && str(args.status) !== 'fixed'
        ? str(args.status)
        : 'open'
      return mutate(path, (state) => {
        const fix = (state.fixes ?? []).find((f) => f.id === fixId)
        if (!fix) throw new Error(`no fix with id ${fixId} (call get_board for the real ids)`)
        fix.status = status
        // Leaving fixed_at set would keep claiming it was closed on a date that
        // no longer holds -- same reason the tracker engine clears it.
        fix.fixed_at = ''
        const note = str(args.note)
        if (note) fix.problem = fix.problem ? `${fix.problem}\n${note}` : note
        logActivity(
          state,
          status === 'wontfix' ? 'fix-wontfix' : 'fix-reopen',
          `${status === 'wontfix' ? 'parked' : 'reopened'}: ${fix.title}`,
          str(args.agent)
        )
        return { id: fix.id, title: fix.title, status: fix.status }
      })
    }
  },
  {
    name: 'add_milestone',
    description:
      'Add a roadmap milestone (a phase of a bigger plan), optionally with a target date/version.',
    inputSchema: {
      type: 'object',
      properties: P({
        title: { type: 'string' },
        target: { type: 'string' }
      }),
      required: ['project', 'title']
    },
    run: (args) => {
      const path = resolveProject(args)
      const title = str(args.title).trim()
      if (!title) throw new Error('title is required')
      return mutate(path, (state) => {
        state.roadmap ??= []
        const m = {
          id: newId('m_'),
          title,
          target: str(args.target),
          done: false,
          order: state.roadmap.length,
          item_ids: []
        }
        state.roadmap.push(m)
        logActivity(state, 'milestone-add', `roadmap: ${m.title}`, str(args.agent))
        return { id: m.id, title: m.title, target: m.target }
      })
    }
  },
  {
    name: 'set_milestone',
    description: 'Mark a milestone done, or rename/retarget it.',
    inputSchema: {
      type: 'object',
      properties: P({
        milestone_id: {
          type: 'string',
          description: 'm_... from add_milestone/get_board; `id` also works.'
        },
        id: { type: 'string' },
        done: { type: 'boolean' },
        title: { type: 'string' },
        target: { type: 'string' }
      }),
      required: ['project']
    },
    run: (args) => {
      const path = resolveProject(args)
      const mid = str(args.milestone_id) || str(args.id)
      return mutate(path, (state) => {
        const m = (state.roadmap ?? []).find((x) => x.id === mid)
        if (!m) throw new Error(`no milestone with id ${mid} (call get_board for the real ids)`)
        if (typeof args.done === 'boolean') m.done = args.done
        if (typeof args.title === 'string') m.title = args.title
        if (typeof args.target === 'string') m.target = args.target
        logActivity(state, 'milestone', `${m.title}${m.done ? ' -> done' : ''}`, str(args.agent))
        return { id: m.id, title: m.title, done: m.done }
      })
    }
  },
  {
    name: 'clean_doc',
    description:
      'Strip invisible watermark characters (zero-width, bidi, tag chars, odd spaces) from a doc you wrote. Run on every markdown/text doc before calling it finished.',
    inputSchema: {
      type: 'object',
      properties: P({
        path: { type: 'string' },
        inspect_only: { type: 'boolean' }
      }),
      required: ['project', 'path']
    },
    run: (args) => {
      const root = resolveProject(args)
      const rel = str(args.path)
      if (!rel) throw new Error('path is required')
      const file = isAbsolute(rel) ? rel : join(root, rel)
      // Stay inside the project: a tool that rewrites files must not be usable
      // to reach somewhere else on disk.
      // startsWith alone would let a sibling directory through -- '/proj-evil'
      // starts with '/proj'. Compare against the root plus its separator.
      const resolvedRoot = resolve(root)
      const resolvedFile = resolve(file)
      if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(resolvedRoot + sep)) {
        throw new Error('path must be inside the project')
      }
      if (!existsSync(file)) throw new Error(`no such file: ${rel}`)
      const before = readFileSync(file, 'utf8')
      const report = cleanMarks(before)
      if (!args.inspect_only && report.changed) {
        const tmp = `${file}.${process.pid}.tmp`
        try {
          writeFileSync(tmp, report.cleaned, 'utf8')
          renameSync(tmp, file)
        } catch (err) {
          try {
            rmSync(tmp, { force: true })
          } catch {
            /* best effort */
          }
          throw err
        }
      }
      return {
        path: rel,
        removed: report.removed,
        total: report.total,
        changed: report.changed,
        written: Boolean(!args.inspect_only && report.changed)
      }
    }
  },
  {
    name: 'add_version',
    description: 'Record a milestone or release you just shipped.',
    inputSchema: {
      type: 'object',
      properties: P({
        version: { type: 'string' },
        notes: { type: 'string' },
        added: { type: 'array', items: { type: 'string' } },
        fixed: { type: 'array', items: { type: 'string' } },
        changed: { type: 'array', items: { type: 'string' } }
      }),
      required: ['project', 'version']
    },
    run: (args) => {
      const path = resolveProject(args)
      return mutate(path, (state) => {
        const entry = {
          version: str(args.version).trim() || state.version,
          date: nowIso(),
          notes: str(args.notes),
          added: arr(args.added), fixed: arr(args.fixed), changed: arr(args.changed)
        }
        state.versions.unshift(entry)
        state.version = entry.version
        logActivity(state, 'version', `cut v${entry.version}`)
        return { version: entry.version }
      })
    }
  }
]

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

// --------------------------------------------------------------------------- JSON-RPC

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

function handle(msg) {
  const { id, method, params } = msg
  // A notification has no id and must never be answered.
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      const who = params?.clientInfo?.name
      if (typeof who === 'string' && who.trim()) CLIENT_ACTOR = who.trim().slice(0, 60)
      reply(id, {
        protocolVersion: typeof asked === 'string' && asked ? asked : FALLBACK_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      })
      return
    }
    case 'notifications/initialized':
    case 'initialized':
      return // nothing to answer
    case 'ping':
      if (!isNotification) reply(id, {})
      return
    case 'tools/list':
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      return
    case 'tools/call': {
      const tool = TOOL_BY_NAME.get(params?.name)
      if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`)
      try {
        const out = tool.run(params?.arguments ?? {})
        reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })
      } catch (err) {
        // A tool failure is a result, not a transport error: the model should
        // see what went wrong and correct itself.
        const message = err instanceof Error ? err.message : String(err)
        // Also to stderr: MCP clients capture it, so when a board stays empty
        // the reason ("project path does not exist", a bad id) is on record
        // instead of having to be guessed at from "nothing happened".
        process.stderr.write(`[planide-mcp] ${params?.name ?? 'tool'} failed: ${message}\n`)
        reply(id, {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true
        })
      }
      return
    }
    default:
      if (!isNotification) fail(id, -32601, `method not found: ${method}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      process.stderr.write('[planide-mcp] dropped a malformed frame\n')
      continue
    }
    try {
      handle(msg)
    } catch (err) {
      process.stderr.write(`[planide-mcp] ${err instanceof Error ? err.message : String(err)}\n`)
      if (msg && msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, 'internal error')
    }
  }
})
process.stdin.on('end', () => process.exit(0))
