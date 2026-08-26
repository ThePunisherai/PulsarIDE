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
 * and close fixes, and cut versions — but it can NEVER set `verified` or
 * `locked`. Those are the user's alone, so an agent cannot confirm its own work
 * or unprotect what it is about to change.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

const SERVER_NAME = 'planide'
const SERVER_VERSION = '2.0.0'
/** Spoken if the client does not name one. Echoing the client's is preferred. */
const FALLBACK_PROTOCOL = '2026-06-18'

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
    activity: []
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
    item.locked ??= false
    item.locked_at ??= ''
    item.tags ??= []
    item.notes ??= ''
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
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
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
  const confirmed = items.filter((i) => i.verified).length
  const working = counts.works + counts.done
  return {
    total_items: items.length,
    counts,
    confirmed,
    unconfirmed: items.filter((i) => (i.status === 'works' || i.status === 'done') && !i.verified).length,
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

/** Resolve + validate the `project` argument every tool takes. */
function resolveProject(args) {
  const raw = typeof args?.project === 'string' ? args.project.trim() : ''
  if (!raw) throw new Error('project is required: pass the absolute path of the project directory')
  const path = isAbsolute(raw) ? raw : resolve(raw)
  if (!existsSync(path)) throw new Error(`project path does not exist: ${path}`)
  return path
}

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback)
const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])

/** Read board, apply fn, write board. Every mutating tool goes through here. */
function mutate(path, fn) {
  const state = loadState(path)
  const result = fn(state)
  saveState(path, state)
  return result
}

// --------------------------------------------------------------------------- tools

const P = (extra = {}) => ({
  project: { type: 'string', description: "Absolute path of the project directory (the workspace you are working in)." },
  ...extra
})

const TOOLS = [
  {
    name: 'get_board',
    description:
      'Read the project board before you start: items with their status, open fixes, and progress. Always call this first so you build on the real state instead of guessing.',
    inputSchema: { type: 'object', properties: P(), required: ['project'] },
    run: (args) => {
      const path = resolveProject(args)
      const state = loadState(path)
      return {
        project: state.name,
        path,
        version: state.version,
        progress: progress(state),
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
    name: 'add_item',
    description:
      "Put a piece of work on the board. Use status 'todo' the moment the user asks for something or you plan a step you have not started, 'wip' when you begin it, 'works' once it genuinely works, and 'done' when it is finished and closed out. Break a big request into several todo items.",
    inputSchema: {
      type: 'object',
      properties: P({
        title: { type: 'string', description: 'Short description of the work.' },
        status: { type: 'string', enum: ITEM_STATUSES, description: "Defaults to 'todo'." },
        notes: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string' },
        agent: { type: 'string', description: 'Your name, recorded as who claimed this.' }
      }),
      required: ['project', 'title']
    },
    run: (args) => {
      const path = resolveProject(args)
      const title = str(args.title).trim()
      if (!title) throw new Error('title is required')
      const status = ITEM_STATUSES.includes(str(args.status)) ? args.status : 'todo'
      const agent = str(args.agent)
      return mutate(path, (state) => {
        const item = {
          id: newId('i_'), title, status,
          notes: str(args.notes), tags: arr(args.tags), priority: str(args.priority, 'normal'),
          created_at: nowIso(), updated_at: nowIso(),
          claimed_by: agent, verified: false, verified_at: '', locked: false, locked_at: ''
        }
        state.items.push(item)
        logActivity(state, 'item-add', `added ${item.title} (${status})`, agent)
        return { id: item.id, title: item.title, status: item.status }
      })
    }
  },
  {
    name: 'set_item',
    description:
      "Move an item as the work really changes: 'wip' when you start, 'works' when it works, 'done' when it is finished and you are not coming back to it, 'broken' when it fails. Do not leave finished work sitting in 'works' -- 'works' means it functions but is still in play, 'done' means closed out, and the board shows them in different columns. Cannot confirm or protect an item -- those stay the user's.",
    inputSchema: {
      type: 'object',
      properties: P({
        item_id: { type: 'string' },
        status: { type: 'string', enum: ITEM_STATUSES },
        title: { type: 'string' },
        notes: { type: 'string' },
        agent: { type: 'string' }
      }),
      required: ['project', 'item_id']
    },
    run: (args) => {
      const path = resolveProject(args)
      const itemId = str(args.item_id)
      return mutate(path, (state) => {
        const item = (state.items ?? []).find((i) => i.id === itemId)
        if (!item) throw new Error(`no item with id ${itemId} (call get_board for the real ids)`)
        const next = str(args.status)
        const statusChanged = next && ITEM_STATUSES.includes(next) && next !== item.status
        // A status change drops the user's confirmation: what they confirmed is
        // no longer what the item says.
        if (statusChanged && item.verified) { item.verified = false; item.verified_at = '' }
        if (statusChanged) item.status = next
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
        return { id: item.id, title: item.title, status: item.status, verified: item.verified }
      })
    }
  },
  {
    name: 'add_fix',
    description: 'Log a bug the moment you hit or find one: what is wrong and where.',
    inputSchema: {
      type: 'object',
      properties: P({
        title: { type: 'string' },
        problem: { type: 'string', description: 'What is wrong, and where.' },
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
        const fix = {
          id: newId('f_'), title,
          problem: str(args.problem), solution: str(args.solution),
          item_id: str(args.item_id), agent, status,
          created_at: nowIso(), fixed_at: status === 'fixed' ? nowIso() : ''
        }
        state.fixes.push(fix)
        logActivity(state, 'fix-add', `logged fix: ${fix.title}`, agent)
        return { id: fix.id, title: fix.title, status: fix.status }
      })
    }
  },
  {
    name: 'mark_fixed',
    description: 'Close a fix once the user says it is solved (or you verified it).',
    inputSchema: {
      type: 'object',
      properties: P({
        fix_id: { type: 'string' },
        solution: { type: 'string', description: 'What actually fixed it.' },
        agent: { type: 'string' }
      }),
      required: ['project', 'fix_id']
    },
    run: (args) => {
      const path = resolveProject(args)
      const fixId = str(args.fix_id)
      return mutate(path, (state) => {
        const fix = (state.fixes ?? []).find((f) => f.id === fixId)
        if (!fix) throw new Error(`no fix with id ${fixId} (call get_board for the real ids)`)
        fix.status = 'fixed'
        fix.fixed_at = nowIso()
        if (typeof args.solution === 'string' && args.solution) fix.solution = args.solution
        logActivity(state, 'fix-done', `fixed: ${fix.title}`, str(args.agent))
        return { id: fix.id, title: fix.title, status: fix.status }
      })
    }
  },
  {
    name: 'add_milestone',
    description:
      'Add a roadmap milestone: a goal several items build toward, optionally with a target (a date, a version, or a phase). Use this when the user describes a plan in phases, or when you break a large request into stages -- the roadmap is what shows where the project is heading, and it stays empty unless you fill it.',
    inputSchema: {
      type: 'object',
      properties: P({
        title: { type: 'string', description: 'What this milestone delivers.' },
        target: { type: 'string', description: 'Optional target: a date, version or phase.' }
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
    description: 'Mark a roadmap milestone done (or rename/retarget it) once its work is finished.',
    inputSchema: {
      type: 'object',
      properties: P({
        milestone_id: { type: 'string' },
        done: { type: 'boolean' },
        title: { type: 'string' },
        target: { type: 'string' }
      }),
      required: ['project', 'milestone_id']
    },
    run: (args) => {
      const path = resolveProject(args)
      const mid = str(args.milestone_id)
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
        reply(id, {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
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
