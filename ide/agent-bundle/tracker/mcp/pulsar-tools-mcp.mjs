#!/usr/bin/env node
/**
 * pulsar-tools — the Pulse Agent's own tools, over MCP.
 *
 * The team-lead files already tell agents to call these. They named a server
 * that was never shipped or registered, so on Codex, Cursor, or any client
 * without native `Bash` into the toolkit, the instruction pointed at nothing.
 *
 * Four tools, chosen because each one works for a PulsarIDE user on their own
 * project:
 *
 *   route_task   — which team and which named specialists fit this task
 *   check_anti_loop / record_anti_loop_failure — do not retry what already failed
 *   re_triage    — static triage of a binary, via the bundled RE toolkit
 *
 * Deliberately NOT ported from ThePunisher-Agent's Python server: `run_verify`
 * and `council_memory_overview` run that repo's own scripts against that repo.
 * Shipping them here would give every user two tools that can only fail.
 *
 * Zero dependencies, run by the IDE's own Electron as Node — the same shape as
 * planide-mcp.mjs, and for the same reason: a tool that needs `pip install`
 * first is a tool most people never get.
 *
 * Transport: MCP stdio — newline-delimited JSON-RPC 2.0 on stdin/stdout.
 * Nothing may ever be written to stdout except protocol frames.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_NAME = 'pulsar-tools'
const SERVER_VERSION = '1.0.0'
const FALLBACK_PROTOCOL = '2024-11-05'

/** The deployed bundle root: this file lives at <root>/tracker/mcp/. */
const BUNDLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// --------------------------------------------------------------------------- routing

// Ported verbatim from ThePunisher-Agent's scripts/router.py so the IDE and the
// CLI route identically. Both lists are curated from live diagnostic batteries
// there -- entries were added only after a real query proved them necessary --
// so they are copied rather than re-derived by guesswork.
const STOP = new Set([
  'a', 'an', 'and', 'as', 'at', 'auto', 'be', 'by', 'can', 'custom', 'do', 'does', 'find', 'for', 'from', 'has', 'help', 'how', 'i', 'in', 'into', 'is', 'issue', 'it', 'me', 'my', 'need', 'of', 'on', 'or', 'our', 'please', 'problem', 're', 'so', 'that', 'the', 'this', 'to', 'trying', 'up', 'use', 'using', 'want', 'we', 'what', 'why', 'with', 'you'
])

const NORMALIZE = {
  'analysis': 'analyze',
  'analyzed': 'analyze',
  'analyzes': 'analyze',
  'analyzing': 'analyze',
  'audited': 'audit',
  'auditing': 'audit',
  'audits': 'audit',
  'automated': 'automate',
  'automates': 'automate',
  'automating': 'automate',
  'automation': 'automate',
  'configuration': 'configure',
  'configured': 'configure',
  'configures': 'configure',
  'configuring': 'configure',
  'created': 'create',
  'creates': 'create',
  'creating': 'create',
  'debugged': 'debug',
  'debugging': 'debug',
  'debugs': 'debug',
  'deployed': 'deploy',
  'deploying': 'deploy',
  'deploys': 'deploy',
  'documentation': 'document',
  'documented': 'document',
  'documenting': 'document',
  'documents': 'document',
  'exploitation': 'exploit',
  'exploited': 'exploit',
  'exploiting': 'exploit',
  'exploits': 'exploit',
  'fixed': 'fix',
  'fixes': 'fix',
  'fixing': 'fix',
  'hacked': 'hack',
  'hacking': 'hack',
  'hacks': 'hack',
  'implementation': 'implement',
  'implemented': 'implement',
  'implementing': 'implement',
  'implements': 'implement',
  'integrated': 'integrate',
  'integrates': 'integrate',
  'integrating': 'integrate',
  'integration': 'integrate',
  'migrated': 'migrate',
  'migrates': 'migrate',
  'migrating': 'migrate',
  'migration': 'migrate',
  'patched': 'patch',
  'patches': 'patch',
  'patching': 'patch',
  'postgres': 'postgresql',
  'refactored': 'refactor',
  'refactoring': 'refactor',
  'refactors': 'refactor',
  'reversed': 'reverse',
  'reversing': 'reverse',
  'reviewed': 'review',
  'reviewing': 'review',
  'reviews': 'review',
  'scanned': 'scan',
  'scanning': 'scan',
  'scans': 'scan',
  'tested': 'test',
  'testing': 'test',
  'tests': 'test',
  'updated': 'update',
  'updates': 'update',
  'updating': 'update',
  'writes': 'write',
  'writing': 'write'
}

/** 'water' is a unique team-name word that is also an ordinary noun: a GLSL
 *  water-ripple query is graphics, not utilities. Same curation precedent. */
const NAME_BONUS_EXCLUDE = new Set(['water'])

function tokenize(text) {
  const out = []
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue
    const w = NORMALIZE[raw] ?? raw
    if (STOP.has(w)) continue
    out.push(w)
  }
  return out
}

let INDEX = null

/**
 * Build the routing index off the specialist files the app deploys. Reading the
 * shipped roster rather than carrying a second copy means routing can never
 * name an agent the user does not actually have.
 */
function index() {
  if (INDEX) return INDEX
  const dir = join(BUNDLE_ROOT, 'specialists')
  const teams = []
  let names = []
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')
  } catch {
    INDEX = { teams: [], df: new Map() }
    return INDEX
  }
  for (const file of names) {
    let text
    try {
      text = readFileSync(join(dir, file), 'utf8')
    } catch {
      continue
    }
    const slug = file.replace(/\.md$/, '')
    const nameLine = /^name:\s*(.+)$/m.exec(text)
    const agents = []
    for (const line of text.split('\n')) {
      const m = /^-\s+\*\*(.+?)\*\*\s+—\s+(.*)$/.exec(line)
      if (m) agents.push({ name: m[1].trim(), role: m[2].trim() })
    }
    const bag = new Map()
    for (const w of tokenize(text)) bag.set(w, (bag.get(w) ?? 0) + 1)
    teams.push({ slug, name: nameLine ? nameLine[1].trim() : slug, agents, bag })
  }
  // Document frequency, so a word every team uses ("engineering") counts for
  // little and a word only one team uses counts for a lot.
  const df = new Map()
  for (const t of teams) for (const w of t.bag.keys()) df.set(w, (df.get(w) ?? 0) + 1)
  // How many team NAMES contain each word. The name bonus below only applies to
  // near-unique words: this roster's "X Technology Engineering" convention puts
  // "engineering" in most names, and bonusing that would tilt every query
  // toward whichever sector team happened to match it.
  const nameDf = new Map()
  for (const t of teams) {
    t.nameTokens = new Set(tokenize(t.name))
    for (const w of t.nameTokens) nameDf.set(w, (nameDf.get(w) ?? 0) + 1)
  }
  INDEX = { teams, df, nameDf }
  return INDEX
}

function routeTask(query, top) {
  const { teams, df, nameDf } = index()
  if (teams.length === 0) return { matches: [], note: 'No specialist roster is deployed.' }
  const words = tokenize(query)
  if (words.length === 0) return { matches: [], note: 'Nothing to route on.' }
  const n = teams.length
  const scored = []
  for (const t of teams) {
    let score = 0
    const hits = []
    for (const w of new Set(words)) {
      const tf = t.bag.get(w)
      if (!tf) continue
      const idf = Math.log((n + 1) / ((df.get(w) ?? 1) + 0.5)) + 1
      // Sublinear TF. A 100-agent team whose domain IS one word repeats it in
      // every role line; raw frequency let that volume beat teams with more
      // varied, more relevant vocabulary. log caps how far repetition alone
      // can carry a team.
      let term = (1 + Math.log(tf)) * idf
      // A query word that IS the team's own name is the least ambiguous signal
      // this can see -- someone naming the team. 2.5x is a weight, not an
      // override, so a genuinely better fit elsewhere can still win.
      if (t.nameTokens.has(w) && (nameDf.get(w) ?? 0) <= 1 && !NAME_BONUS_EXCLUDE.has(w)) {
        term *= 2.5
      }
      score += term
      hits.push(w)
    }
    if (score <= 0) continue
    // Which named specialists inside the team actually match the words.
    const agents = t.agents
      .map((a) => {
        const bag = new Set(tokenize(`${a.name} ${a.role}`))
        let s = 0
        for (const w of new Set(words)) if (bag.has(w)) s += 1
        return { ...a, score: s }
      })
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, top))
      .map(({ name, role }) => ({ name, role }))
    scored.push({ team: t.name, slug: t.slug, score: Number(score.toFixed(2)), matched: hits, agents })
  }
  scored.sort((a, b) => b.score - a.score)
  return {
    matches: scored.slice(0, 3),
    note:
      scored.length === 0
        ? 'No team matched. Take it to the Council rather than guessing.'
        : 'Read the named team file under the specialists directory and adopt the specialist inline.'
  }
}

// --------------------------------------------------------------------------- anti-loop

/**
 * Same shape and location ThePunisher-Agent's own anti-loop.sh uses, so a
 * project touched by either records into one registry rather than two that
 * disagree about what has already failed.
 */
function registryPath(cwd) {
  return join(resolve(cwd || '.'), '.thepunisher', 'failed-registry.json')
}

function readRegistry(cwd) {
  const p = registryPath(cwd)
  if (!existsSync(p)) return { failed: [] }
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'))
    return { failed: Array.isArray(d.failed) ? d.failed : [] }
  } catch {
    return { failed: [] }
  }
}

function writeRegistry(cwd, data) {
  const p = registryPath(cwd)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, p)
}

const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * A reworded repeat of the same approach.
 *
 * Containment is how a rewording is caught ("patch the loader" vs "patch the
 * loader in place"), but it was applied to any length, so recording a short
 * approach such as "add a guard" blocked every future approach whose text
 * happened to contain it. That over-blocking is a large part of why this fired
 * far more often than it should. Containment now needs both sides to be
 * substantial; short approaches must match exactly.
 */
const MIN_CONTAINMENT_CHARS = 16

function matches(prev, candidate) {
  const a = normalize(prev)
  const b = normalize(candidate)
  if (!a || !b) return false
  if (a === b) return true
  const shorter = a.length < b.length ? a : b
  if (shorter.length < MIN_CONTAINMENT_CHARS) return false
  return a.includes(b) || b.includes(a)
}

/**
 * How long a recorded failure keeps blocking.
 *
 * A failure is evidence about the code as it was that day. Environments change,
 * dependencies get installed, a missing directory appears -- and an approach
 * that failed then can be the right one now. Past this window the record stays
 * as advice but stops refusing the work.
 */
const BLOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ageMs = (iso) => {
  const t = Date.parse(iso ?? '')
  return Number.isFinite(t) ? Date.now() - t : Infinity
}

// --------------------------------------------------------------------------- RE triage

function reTriage(binaryPath) {
  const script = join(BUNDLE_ROOT, 'tools', 'reverse-engineering', 're-triage.sh')
  if (!existsSync(script)) {
    return { ok: false, error: 'The reverse-engineering toolkit is not deployed.' }
  }
  if (process.platform === 'win32') {
    return {
      ok: false,
      error: 're-triage.sh is a shell driver: Linux and macOS only. On Windows use x64dbg.'
    }
  }
  const target = resolve(String(binaryPath || ''))
  if (!existsSync(target)) return { ok: false, error: `no such file: ${binaryPath}` }
  try {
    const out = execFileSync('bash', [script, target], {
      encoding: 'utf8',
      timeout: 240_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    }).toString()
    return { ok: true, binary: target, triage: out }
  } catch (err) {
    const e = err
    const out = `${String(e?.stdout ?? '')}${String(e?.stderr ?? '')}`.trim()
    return { ok: false, binary: target, error: out || (e instanceof Error ? e.message : String(e)) }
  }
}

// --------------------------------------------------------------------------- tools

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

const TOOLS = [
  {
    name: 'route_task',
    description:
      'Which Pulse Agent team and which named specialists fit a task. Call this before starting non-trivial work so you adopt the right specialist instead of answering as a generic assistant.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The task, in the user\'s own words.' },
        top: { type: 'number', description: 'Specialists per team to name (default 5).' }
      },
      required: ['query']
    },
    run: (args) => routeTask(str(args.query), Number(args.top) > 0 ? Number(args.top) : 5)
  },
  {
    name: 'check_anti_loop',
    description:
      'Has this approach already been tried and failed in this project? Call it BEFORE proposing a fix. A blocked result means pivot, not retry.',
    inputSchema: {
      type: 'object',
      properties: {
        approach: { type: 'string', description: 'The approach you are about to take.' },
        cwd: { type: 'string', description: 'Project directory (default: current).' }
      },
      required: ['approach']
    },
    run: (args) => {
      const approach = str(args.approach)
      if (!approach) throw new Error('approach is required')
      const reg = readRegistry(str(args.cwd) || '.')
      const hit = reg.failed.find((f) => matches(f.approach, approach))
      if (!hit) return { blocked: false, guidance: 'Not tried before. Record it if it fails.' }

      const attempts = Number(hit.count) || 1
      const stale = ageMs(hit.at) > BLOCK_TTL_MS
      // One failure is not a loop -- it can be a transient or a since-fixed
      // cause, and refusing on it made this halt work that would have
      // succeeded. Blocking starts at the second failure of the same approach,
      // and lapses once the record is old enough to no longer be evidence.
      const blocked = attempts >= 2 && !stale
      const shared = {
        approach: hit.approach,
        problem: hit.problem ?? '',
        error: hit.error ?? '',
        recorded_at: hit.at ?? '',
        attempts
      }
      if (blocked) {
        return {
          ...shared,
          blocked: true,
          guidance:
            'This approach failed ' + attempts + ' times here. Pivot rather than retry. ' +
            'If you have since fixed what made it fail, call clear_anti_loop and try again.'
        }
      }
      return {
        ...shared,
        blocked: false,
        warning: stale
          ? 'Tried before and failed, but that record is over a week old, so it is advice rather than a block.'
          : 'Tried once before and failed. Proceed only if you are addressing the reason it failed.',
        guidance: 'Not blocked. Record it again if it fails, which does block it.'
      }
    }
  },
  {
    name: 'record_anti_loop_failure',
    description:
      'Record an approach that failed, so no later turn or session repeats it. Call it the moment something fails -- the check above only knows what was written down.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: { type: 'string' },
        approach: { type: 'string' },
        error: { type: 'string' },
        cwd: { type: 'string' }
      },
      required: ['problem', 'approach', 'error']
    },
    run: (args) => {
      const approach = str(args.approach)
      if (!approach) throw new Error('approach is required')
      const cwd = str(args.cwd) || '.'
      const reg = readRegistry(cwd)
      const hit = reg.failed.find((f) => matches(f.approach, approach))
      if (hit) {
        // A repeat is the signal this exists to catch, so count it rather than
        // discarding it: the second failure is what turns a warning into a block.
        hit.count = (Number(hit.count) || 1) + 1
        hit.at = new Date().toISOString()
        if (str(args.error)) hit.error = str(args.error)
        writeRegistry(cwd, reg)
        return {
          recorded: false,
          note: 'Already recorded; counted as another failure of the same approach.',
          attempts: hit.count,
          blocking: hit.count >= 2,
          total: reg.failed.length
        }
      }
      reg.failed.push({
        problem: str(args.problem),
        approach,
        error: str(args.error),
        at: new Date().toISOString(),
        count: 1
      })
      writeRegistry(cwd, reg)
      return { recorded: true, attempts: 1, blocking: false, total: reg.failed.length }
    }
  },
  {
    name: 'clear_anti_loop',
    description:
      'Clear a recorded failure once you have fixed what made it fail, so that approach is allowed again. Use it when the cause is genuinely gone (a missing file now exists, a dependency is installed), never to get past a block you have not addressed.',
    inputSchema: {
      type: 'object',
      properties: {
        approach: { type: 'string', description: 'The approach to unblock. Omit with all=true to clear every record.' },
        all: { type: 'boolean', description: 'Clear every recorded failure in this project.' },
        cwd: { type: 'string', description: 'Project directory (default: current).' }
      },
      required: []
    },
    run: (args) => {
      const cwd = str(args.cwd) || '.'
      const reg = readRegistry(cwd)
      const before = reg.failed.length
      if (args.all === true) {
        reg.failed = []
        writeRegistry(cwd, reg)
        return { cleared: before, remaining: 0 }
      }
      const approach = str(args.approach)
      if (!approach) throw new Error('approach is required (or pass all: true)')
      reg.failed = reg.failed.filter((f) => !matches(f.approach, approach))
      const cleared = before - reg.failed.length
      writeRegistry(cwd, reg)
      return {
        cleared,
        remaining: reg.failed.length,
        note: cleared ? 'That approach is allowed again.' : 'Nothing matched; nothing was blocking it.'
      }
    }
  },
  {
    name: 're_triage',
    description:
      'Static triage of a binary through the bundled toolkit (Ghidra headless, then radare2, then objdump+strings). Use instead of guessing at a binary you cannot read. Linux and macOS.',
    inputSchema: {
      type: 'object',
      properties: { binary_path: { type: 'string', description: 'Path to the binary.' } },
      required: ['binary_path']
    },
    run: (args) => {
      const p = str(args.binary_path)
      if (!p) throw new Error('binary_path is required')
      return reTriage(isAbsolute(p) ? p : resolve(p))
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
      return
    case 'ping':
      if (!isNotification) reply(id, {})
      return
    case 'tools/list':
      reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      })
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
      process.stderr.write('[pulsar-tools] dropped a malformed frame\n')
      continue
    }
    try {
      handle(msg)
    } catch (err) {
      process.stderr.write(`[pulsar-tools] ${err instanceof Error ? err.message : String(err)}\n`)
      if (msg && msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, 'internal error')
    }
  }
})
process.stdin.on('end', () => process.exit(0))
