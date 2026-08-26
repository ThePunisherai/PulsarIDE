/**
 * Pulse Agent, pre-installed.
 *
 * PulsarIDE ships ThePunisher-Agent's team-lead subagents and its curated skills
 * inside the app (see resources/pulsar-agents, assembled from
 * ThePunisherai/ThePunisher-Agent). On startup this deploys them into the shared
 * locations the CLI agents running inside the IDE actually read — so Claude Code,
 * Codex and Gemini have the whole roster and the orchestration skill available in
 * every project, with no dashboard and no separate install step.
 *
 * Deliberately conservative:
 *
 *  * Only the 101 team leads deploy as native subagents — never the 5,050
 *    specialists. Deploying all of them blows Claude Code's ~15k-token
 *    agent-description budget; that is ThePunisher-Agent's own documented lesson.
 *    A team lead reads and adopts a specialist on demand.
 *  * Version-gated: it redeploys only when the bundled version changes, so a
 *    normal launch pays nothing.
 *  * Reconcile-not-accumulate: it tracks exactly what it wrote in a marker file
 *    and removes only those on redeploy. It never touches an agent, skill or hook
 *    the user configured themselves.
 *  * It can never break startup — the whole thing is wrapped, and a failure is
 *    logged and swallowed.
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

type Manifest = {
  bundle_version: string
  team_leads: number
  skills: number
  skill_names: string[]
}

type Marker = {
  bundle_version: string
  agents: string[] // absolute paths we wrote
  skills: string[] // skill names we deployed into ~/.claude/skills
  hooks: string[] // absolute hook-script paths we wrote
  tracker?: string // deployed tracker root we own
  mcp?: string[] // MCP server names we registered at user scope
}

export type DeployResult = {
  deployed: boolean
  reason: string
  agents: number
  skills: number
  hookWired: boolean
  trackerDeployed: boolean
  mcpWired: boolean
}

/**
 * Appended to every deployed team-lead body (Claude Code, Gemini CLI, Codex) so
 * a subagent PulsarIDE dispatches knows the project has a live board and updates
 * it as it works. The main session gets the same nudge from the SessionStart
 * hook's additionalContext (graphify-bootstrap), so this is reinforcement, not
 * the only channel — which is why it can stay short. Kept in the body, never the
 * frontmatter description, so it costs nothing against Claude Code's
 * agent-description token budget.
 */
const TRACKER_INSTRUCTION = `

## PulsarIDE built-in tracker — keep it in sync with the chat, automatically

This project has a built-in board, stored in \`<project>/.planide/state.json\` and
shown live in the IDE's Tracker tab. Keeping it current is part of your job — you
never need to be asked, and the board is created on first use, so it always works.

- **Read it first.** Call the \`planide\` MCP tool \`get_board\` before you start, so
  you build on the real state instead of guessing. Pass \`project\` = the project's
  absolute path to every tool.
- **Mirror the conversation onto the board, in the same turn the fact appears:**
  - The user asks for something, or you plan a step you have not started yet →
    \`add_item\` (status \`todo\`), so the plan is on the board before any code moves.
    Break a big request into several \`todo\` items.
  - You start or build something → \`set_item\` to \`wip\` (or \`add_item\` \`wip\`).
  - You get something working → \`set_item\` status \`works\` (recorded as *your*
    claim, attributed to you; the user confirms it separately — that's by design).
  - That piece is finished and you are not coming back to it → \`set_item\` \`done\`.
    \`works\` means it functions but is still in play; \`done\` means closed out. They
    are different columns on the board, so finished work must not sit in \`works\`.
  - The user describes phases, or you split a big request into stages →
    \`add_milestone\` (and \`set_milestone\` done when the stage lands). The Roadmap
    stays empty unless you fill it, so a multi-step project belongs there too.
  - You hit or find a bug → \`add_fix\` (problem + where), or \`set_item\` status \`broken\`.
  - The user says "that's solved / fixed / it works now" → \`mark_fixed\` that fix,
    and \`set_item\` the related item to \`works\`.
  - The user says something is broken or still failing → \`set_item\` status \`broken\`.
  - You ship a milestone or bump the version → \`add_version\`.
- **Before you tell the user "done" or "please test", update the board first**, so
  what it shows matches what you just claimed. A turn that ends "everything works,
  test it" while the board still says \`todo\`/\`broken\` is not finished.
- **Only report what is real.** \`works\` means it works; \`broken\` means it doesn't.
  You cannot set the \`verified\`/\`locked\` flags — those stay the user's. Never
  green-wash the board.
`

/** Where the bundle lives: the dev checkout, or the packaged app's resources. */
export function bundleRoot(opts: { resourcesPath?: string; appPath?: string } = {}): string | null {
  const candidates = [
    opts.resourcesPath ? join(opts.resourcesPath, 'pulsar-agents') : null,
    opts.appPath ? join(opts.appPath, 'resources', 'pulsar-agents') : null,
    // dev: electron-vite runs from the checkout root
    join(process.cwd(), 'resources', 'pulsar-agents')
  ].filter((p): p is string => Boolean(p))
  for (const c of candidates) {
    if (existsSync(join(c, 'manifest.json'))) return c
  }
  return null
}

function readManifest(root: string): Manifest {
  return JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Manifest
}

/**
 * Write a config file another tool owns, atomically.
 *
 * `~/.claude/settings.json` is shared: Claude Code reads it, Orca installs the
 * managed agent hooks it drives its orchestrator's subagent tracking from, and
 * we add a SessionStart entry. A plain writeFileSync truncates the file first,
 * so a crash or a concurrent reader mid-write leaves behind exactly the
 * "truncated settings.json that the agent CLI would refuse to load" that Orca's
 * own installer takes pains to avoid. Same for ~/.claude.json and the Codex,
 * Cursor and Gemini configs. Write to a sibling temp file and rename: a rename
 * within a directory is atomic, so a reader sees either the old file or the new
 * one, never half of one.
 */
function writeConfigAtomic(path: string, text: string): void {
  const tmp = `${path}.pulsar-${process.pid}.tmp`
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, path)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* the temp file is already gone */
    }
    throw err
  }
}

function configDir(home: string): string {
  return join(home, '.config', 'pulsaride')
}

function readMarker(home: string): Marker | null {
  const path = join(configDir(home), 'agent-bundle.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Marker
  } catch {
    return null
  }
}

/** Front-matter name + body, for converting a team-lead .md to Codex TOML. */
function parseAgent(md: string): { name: string; description: string; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const front = m ? m[1] : ''
  const body = m ? m[2] : md
  const name = (front.match(/^name:\s*(.+)$/m)?.[1] ?? 'pulse-agent').trim()
  // description can be a folded (>) block; take the first line as a summary.
  const descLine = front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const desc = descLine === '>' || descLine === '|' ? (front.match(/\n\s{2,}(.+)/)?.[1] ?? '').trim() : descLine
  return { name, description: desc, body: body.trim() }
}

function toToml(md: string): string {
  const { name, description, body } = parseAgent(md)
  // Single-line basic strings for name/description (short, escape quotes/backslashes).
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  // developer_instructions uses a LITERAL multi-line string ('''…'''), not a basic
  // one ("""…"""): a basic string interprets backslash escapes, so a persona body
  // with a regex (\b, \d), a hex byte (\x) or a Windows path would be an invalid
  // TOML escape and break Codex's parse of that agent. A literal string takes the
  // body verbatim; its only constraint is it can't contain ''' (rare — swapped for
  // ' ' '). The 101 current team leads have no backslashes, but the growth pool and
  // future agents do, so this removes a real latent failure mode.
  const literalBody = body.replace(/'''/g, "' ' '")
  return (
    `name = "${esc(name)}"\n` +
    `description = "${esc(description)}"\n` +
    `developer_instructions = '''\n${literalBody}\n'''\n`
  )
}

/**
 * Deploy the bundle. `opts.home` overrides the home dir (tests); `opts.force`
 * redeploys even if the version is unchanged.
 */
export function deployAgentBundle(
  opts: {
    home?: string
    resourcesPath?: string
    appPath?: string
    force?: boolean
    /** Provision the self-contained Python venv (graphify + fastmcp). Default true; tests pass false. */
    provisionPyEnv?: boolean
  } = {}
): DeployResult {
  const home = opts.home ?? homedir()
  const skip = (reason: string, mcpWired = false, trackerDeployed = false): DeployResult => ({
    deployed: false,
    reason,
    agents: 0,
    skills: 0,
    hookWired: false,
    trackerDeployed,
    mcpWired
  })
  try {
    const root = bundleRoot(opts)
    if (!root) return skip('bundle not found')
    const manifest = readManifest(root)
    const prev = readMarker(home)

    // Runs EVERY launch (cheap, idempotent), before the version gate: keep the
    // self-contained Python venv provisioned and re-point the planide MCP at the
    // best available python. This lets the MCP switch to the venv the moment the
    // background install finishes, instead of waiting for a version bump.
    if (opts.provisionPyEnv !== false) ensurePyEnv(home)
    const alreadyTracked = existsSync(join(configDir(home), 'tracker', 'mcp', 'planide-mcp.mjs'))
    let mcpWired = alreadyTracked ? registerTrackerForAllAgents(home) : false

    if (!opts.force && prev && prev.bundle_version === manifest.bundle_version) {
      return skip(`already at ${manifest.bundle_version}`, mcpWired, alreadyTracked)
    }

    // Reconcile: remove what a previous deploy of ours wrote, ours only.
    if (prev) {
      for (const p of prev.agents) rmSync(p, { force: true })
      for (const name of prev.skills) rmSync(join(home, '.claude', 'skills', name), { recursive: true, force: true })
      if (prev.tracker) rmSync(prev.tracker, { recursive: true, force: true })
    }

    // --- agents: team leads -> Claude Code, Gemini CLI, Codex ------------- //
    const agentDir = join(root, 'agents')
    // Only real agents — a .md with a `name:` frontmatter. This excludes the
    // bundle's own README.md, which was being deployed as a malformed agent
    // (empty description, generic name) and could make Codex reject the whole
    // ~/.codex/agents set — the "subagents suddenly stopped working" report.
    const agentFiles = readdirSync(agentDir).filter((f) => {
      if (!f.endsWith('.md')) return false
      try {
        return /^name:\s*\S/m.test(readFileSync(join(agentDir, f), 'utf8').slice(0, 600))
      } catch {
        return false
      }
    })
    const wroteAgents: string[] = []

    const claudeAgents = join(home, '.claude', 'agents')
    const geminiAgents = join(home, '.gemini', 'agents')
    const codexAgents = join(home, '.codex', 'agents')
    mkdirSync(claudeAgents, { recursive: true })
    mkdirSync(geminiAgents, { recursive: true })
    mkdirSync(codexAgents, { recursive: true })

    /**
     * Do not deploy a second copy of the same roster.
     *
     * PulsarIDE's bundle IS ThePunisher-Agent's roster. Someone who also runs
     * that project's standalone installer already has the identical 100 team
     * leads in these very directories, under a `thepunisher-` prefix -- and
     * because our prefix is `pulse-`, the two do not overwrite, they ADD.
     *
     * Claude Code budgets ~15k tokens for agent descriptions. One roster costs
     * ~10.5k (measured off these files). Two costs ~21k, which puts Claude Code
     * over the limit and is exactly how "subagents suddenly stopped working"
     * happens -- the roster is not broken, it is too big to load.
     *
     * So: if a tool's directory already carries that roster, we skip our own
     * copies there rather than doubling it. Never by deleting theirs -- that is
     * another product's install, not ours to remove. Nothing is lost either:
     * the tracker instruction our copies carry in the body also reaches the main
     * session through the managed block in CLAUDE.md / AGENTS.md / GEMINI.md.
     */
    const hasForeignRoster = (dir: string): boolean => {
      try {
        return readdirSync(dir).some((f) => f.startsWith('thepunisher-'))
      } catch {
        return false
      }
    }
    const skipClaude = hasForeignRoster(claudeAgents)
    const skipGemini = hasForeignRoster(geminiAgents)
    const skipCodex = hasForeignRoster(codexAgents)
    if (skipClaude || skipGemini || skipCodex) {
      console.warn(
        '[pulsar] ThePunisher-Agent already provides this roster in ' +
          [skipClaude && 'claude', skipGemini && 'gemini', skipCodex && 'codex']
            .filter(Boolean)
            .join('/') +
          ' -- skipping our duplicate copies to stay inside the agent-description budget'
      )
    }

    for (const file of agentFiles) {
      const md = readFileSync(join(agentDir, file), 'utf8')
      // Append the tracker instruction to the body (never the frontmatter
      // description) so the subagent updates the board with zero token-budget cost.
      const mdOut = `${md.trimEnd()}\n${TRACKER_INSTRUCTION}`
      const base = `pulse-${file}` // pulse- prefix marks ours and avoids clobbering
      const claudePath = join(claudeAgents, base)
      const geminiPath = join(geminiAgents, base)
      const codexPath = join(codexAgents, `pulse-${file.replace(/\.md$/, '.toml')}`)
      if (!skipClaude) {
        writeFileSync(claudePath, mdOut)
        wroteAgents.push(claudePath)
      }
      if (!skipGemini) {
        writeFileSync(geminiPath, mdOut)
        wroteAgents.push(geminiPath)
      }
      if (!skipCodex) {
        writeFileSync(codexPath, toToml(mdOut))
        wroteAgents.push(codexPath)
      }
    }

    // --- skills: curated set incl. orchestration -> Claude Code ----------- //
    const skillsSrc = join(root, 'skills')
    const skillNames = existsSync(skillsSrc)
      ? readdirSync(skillsSrc).filter((d) => existsSync(join(skillsSrc, d, 'SKILL.md')))
      : []
    const claudeSkills = join(home, '.claude', 'skills')
    mkdirSync(claudeSkills, { recursive: true })
    for (const name of skillNames) {
      const dest = join(claudeSkills, name)
      rmSync(dest, { recursive: true, force: true })
      cpSync(join(skillsSrc, name), dest, { recursive: true })
    }

    // --- memory hooks: graphify + Obsidian, per project ------------------- //
    const hookWired = wireHooks(home, root)

    // --- tracker: plan CLI + planide package + planide MCP server ---------- //
    // Deploys the built-in tracker files; the MCP registration (user scope, so an
    // agent in any project can update that project's board — reflected live in the
    // Tracker tab) is the always-run step above, refreshed here now that the files
    // are freshly (re)deployed.
    const trackerRoot = deployTrackerFiles(home, root)
    if (trackerRoot) mcpWired = registerTrackerForAllAgents(home)
    deployToolsFiles(home, root)

    const marker: Marker = {
      bundle_version: manifest.bundle_version,
      agents: wroteAgents,
      skills: skillNames,
      hooks: hookWired ? [join(configDir(home), 'hooks')] : [],
      tracker: trackerRoot ?? undefined,
      mcp: mcpWired ? ['planide'] : []
    }
    mkdirSync(configDir(home), { recursive: true })
    writeFileSync(join(configDir(home), 'agent-bundle.json'), JSON.stringify(marker, null, 2))

    return {
      deployed: true,
      reason: `deployed ${manifest.bundle_version}`,
      agents: agentFiles.length,
      skills: skillNames.length,
      hookWired,
      trackerDeployed: Boolean(trackerRoot),
      mcpWired
    }
  } catch (err) {
    // Never break startup.
    console.warn('[pulsar] agent bundle deploy skipped:', err instanceof Error ? err.message : err)
    return skip('error')
  }
}

/**
 * Copy the graphify + Obsidian memory hooks to a stable location and wire the
 * graphify bootstrap as a Claude Code SessionStart hook — so graphify's graph
 * and the Obsidian note are used for *every* project a session opens, not only
 * when the model remembers to. Reconcile-not-accumulate, keyed on our script
 * name, matching ThePunisher-Agent's own installer exactly.
 */
function wireHooks(home: string, root: string): boolean {
  const hookSrc = join(root, 'hooks')
  const bootstrap = join(hookSrc, 'graphify-bootstrap.sh')
  if (!existsSync(bootstrap)) return false

  const hookDir = join(configDir(home), 'hooks')
  mkdirSync(hookDir, { recursive: true })
  // council-memory.py does the real work (graphify graph + Obsidian note, vault
  // auto-detected); both bootstrap scripts call it, so it ships alongside.
  const council = join(hookSrc, 'council-memory.py')
  if (existsSync(council)) cpSync(council, join(hookDir, 'council-memory.py'))

  // Windows Claude Code cannot run a bash hook, so wire the PowerShell twin
  // there and the bash script everywhere else. Both invoke council-memory.py.
  const onWindows = process.platform === 'win32'
  const ps1Src = join(hookSrc, 'graphify-bootstrap.ps1')
  let dest: string
  let command: string
  if (onWindows && existsSync(ps1Src)) {
    dest = join(hookDir, 'graphify-bootstrap.ps1')
    cpSync(ps1Src, dest)
    command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${dest}"`
  } else {
    dest = join(hookDir, 'graphify-bootstrap.sh')
    cpSync(bootstrap, dest)
    command = dest
  }
  try {
    chmodSync(dest, 0o755)
    if (existsSync(join(hookDir, 'council-memory.py'))) chmodSync(join(hookDir, 'council-memory.py'), 0o755)
  } catch {
    /* non-fatal on filesystems without exec bits */
  }

  const settingsPath = join(home, '.claude', 'settings.json')
  mkdirSync(dirname(settingsPath), { recursive: true })
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8') || '{}') as Record<string, unknown>
    } catch {
      // Never clobber it. This file is not ours: Claude Code keeps env,
      // permissions and statusline here, and Orca installs the managed agent
      // hooks its orchestrator tracks Claude/Codex subagents through. Resetting
      // to {} and writing -- which is what this used to do -- silently deleted
      // all of that and took Orca's subagent orchestration down with it, for
      // any reason a parse can fail: a concurrent write while Orca installs its
      // own hooks, a partial read, a stray BOM. Backing off costs us one
      // graphify hook; the alternative costs the user their agent setup.
      // (registerPlanideMcp already refused to clobber ~/.claude.json for
      // exactly this reason -- this is the same rule, applied consistently.)
      return false
    }
  }
  const hooks = (settings.hooks ??= {}) as Record<string, unknown>
  const events = (hooks.SessionStart ?? []) as unknown[]
  // Drop any prior entry of ours (keyed on the script name), keep everyone else's.
  const kept = events.filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return true
    const inner = (entry as { hooks?: unknown[] }).hooks ?? []
    return !inner.some(
      (h) =>
        typeof h === 'object' &&
        h !== null &&
        String((h as { command?: string }).command ?? '').includes('graphify-bootstrap')
    )
  })
  kept.push({ hooks: [{ type: 'command', command, timeout: 30 }] })
  hooks.SessionStart = kept
  writeConfigAtomic(settingsPath, JSON.stringify(settings, null, 2))
  return true
}

/**
 * Deploy the built-in tracker (the `plan` CLI, the `planide` package and the
 * `planide` MCP server) to a stable location, and register the MCP server at
 * Claude Code *user scope* so every project a session opens can read and write
 * its board without any per-project setup.
 *
 * User scope (`~/.claude.json` top-level `mcpServers`) is deliberate: it is
 * cross-project and needs no approval prompt, unlike a project `.mcp.json`
 * (verified against code.claude.com/docs/en/mcp). The tracker tools each take a
 * `project` path, so one server instance serves every project.
 *
 * Best-effort and reconcile-safe: a failure is swallowed (the passive
 * agent-events recorder and the pure-stdlib `plan` CLI still work), and we only
 * ever touch the single `planide` key in `~/.claude.json`, never anything else.
 */
function deployTrackerFiles(home: string, root: string): string | null {
  const src = join(root, 'tracker')
  if (!existsSync(join(src, 'mcp', 'planide-mcp.mjs'))) return null

  const dest = join(configDir(home), 'tracker')
  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  try {
    chmodSync(join(dest, 'plan'), 0o755)
  } catch {
    /* non-fatal on filesystems without exec bits */
  }
  return dest
}

/** Deploy Pulse Agent's tool kits (the reverse-engineering toolkit) to a stable location. */
function deployToolsFiles(home: string, root: string): string | null {
  const src = join(root, 'tools')
  if (!existsSync(src)) return null
  const dest = join(configDir(home), 'tools')
  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  return dest
}

/** The IDE-owned Python venv (graphify + fastmcp), isolated from the user's own. */
function pyEnvDir(home: string): string {
  return join(configDir(home), 'pyenv')
}
function pyEnvPython(home: string): string {
  const d = pyEnvDir(home)
  return process.platform === 'win32' ? join(d, 'Scripts', 'python.exe') : join(d, 'bin', 'python')
}

/**
 * Register (or refresh) the `planide` stdio MCP server at user scope in
 * `~/.claude.json`. Reconcile-not-accumulate: overwrite only our own key and
 * preserve every other server and every other field in the file. Prefers the
 * IDE's own venv python (which has fastmcp) so the server just works; falls back
 * to the system python until the venv finishes provisioning. Either way the
 * `plan` CLI (pure stdlib) covers agents, so a missing server is never fatal.
 */
function registerPlanideMcp(home: string): boolean {
  const path = join(home, '.claude.json')
  let config: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
    } catch {
      // A malformed ~/.claude.json is Claude Code's own state — never clobber it.
      return false
    }
  }
  const servers = (config.mcpServers ??= {}) as Record<string, unknown>
  const launch = mcpLaunch(home)
  servers.planide = { type: 'stdio', command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) }
  writeConfigAtomic(path, JSON.stringify(config, null, 2))
  return true
}

/** How an agent should launch the tracker MCP server. */
type McpLaunch = { command: string; args: string[]; env?: Record<string, string> }

/**
 * Launch the tracker MCP server with the app's own Electron binary, as a plain
 * Node runtime (`ELECTRON_RUN_AS_NODE=1`).
 *
 * This is the fix for the tracker doing nothing in any agent. It used to run
 * `planide_mcp.py`, which needs Python *and* `fastmcp` — verified: without them
 * the server exits immediately, so the agent had no tracker tools at all and the
 * board could never move, no matter what the user asked for. The IDE cannot
 * assume a working Python: the venv it provisions in the background needs
 * python3, `venv`, and network, and any of those can be missing (a Windows box
 * with no Python, or only the Microsoft Store stub, is the common case).
 *
 * `process.execPath` is the IDE's own executable, so it is always there — the
 * server has zero install steps and cannot be broken by the user's Python.
 * The Python server stays on disk for anyone running it outside the IDE, but
 * nothing here depends on it any more.
 */
function mcpLaunch(home: string): McpLaunch {
  const nodeServer = join(configDir(home), 'tracker', 'mcp', 'planide-mcp.mjs')
  if (existsSync(nodeServer)) {
    return { command: process.execPath, args: [nodeServer], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  // Only reachable before the bundle has ever deployed (or if it was deleted).
  const venvPy = pyEnvPython(home)
  const py = existsSync(venvPy) ? venvPy : process.platform === 'win32' ? 'python' : 'python3'
  return { command: py, args: [join(configDir(home), 'tracker', 'mcp', 'planide_mcp.py')] }
}

/**
 * Register the `planide` MCP for Codex CLI in `~/.codex/config.toml` as a
 * `[mcp_servers.planide]` stdio table (verified shape). No TOML parser needed:
 * strip any prior `[mcp_servers.planide]` block (and its sub-tables), keep every
 * other line verbatim, append a fresh block. This is why Codex — which the user
 * actually runs — saw no tracker tools before: it only ever went into
 * ~/.claude.json.
 */
function registerPlanideMcpCodex(home: string): boolean {
  try {
    const path = join(home, '.codex', 'config.toml')
    let text = ''
    if (existsSync(path)) {
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        return false // don't clobber a file we can't read
      }
    }
    const kept: string[] = []
    let skipping = false
    for (const line of text.split(/\r?\n/)) {
      const header = line.match(/^\s*\[([^\]]+)\]/)
      if (header) {
        const name = header[1]
        skipping = name === 'mcp_servers.planide' || name.startsWith('mcp_servers.planide.')
      }
      if (!skipping) kept.push(line)
    }
    const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const launch = mcpLaunch(home)
    const envBlock = launch.env
      ? Object.entries(launch.env).map(([k, v]) => `${k} = "${esc(v)}"`).join('\n')
      : ''
    const block =
      `[mcp_servers.planide]\ncommand = "${esc(launch.command)}"\n` +
      `args = [${launch.args.map((a) => `"${esc(a)}"`).join(', ')}]\n` +
      (envBlock ? `\n[mcp_servers.planide.env]\n${envBlock}\n` : '')
    const body = kept.join('\n').replace(/\s+$/, '')
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, (body ? body + '\n\n' : '') + block)
    return true
  } catch {
    return false
  }
}

/** Register the `planide` MCP for Cursor in `~/.cursor/mcp.json` (user scope). */
function registerPlanideMcpCursor(home: string): boolean {
  try {
    const path = join(home, '.cursor', 'mcp.json')
    let config: Record<string, unknown> = {}
    if (existsSync(path)) {
      try {
        config = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
      } catch {
        return false
      }
    }
    const servers = (config.mcpServers ??= {}) as Record<string, unknown>
    const launch = mcpLaunch(home)
    servers.planide = { command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) }
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * Register the `planide` MCP for Gemini CLI and Antigravity in
 * `~/.gemini/settings.json` (user scope). Both are Gemini-based and read this
 * same file's `mcpServers` map — verified against google-gemini/gemini-cli's own
 * docs (docs/tools/mcp-server.md) and the github-mcp-server Gemini install guide:
 * a local server is `{ command, args }` stdio, the same shape Cursor uses. This
 * is why Gemini/Antigravity saw the roster and the tracker instruction (via
 * ~/.gemini/agents + GEMINI.md) but not the live `planide` tools — nothing ever
 * wrote the MCP entry for them. Reconcile-not-accumulate: only the `planide` key
 * is touched; every other server and setting in the file is preserved verbatim.
 */
function registerPlanideMcpGemini(home: string): boolean {
  try {
    const path = join(home, '.gemini', 'settings.json')
    let config: Record<string, unknown> = {}
    if (existsSync(path)) {
      try {
        config = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
      } catch {
        // A malformed ~/.gemini/settings.json is Gemini's own state — never clobber it.
        return false
      }
    }
    const servers = (config.mcpServers ??= {}) as Record<string, unknown>
    const launch = mcpLaunch(home)
    servers.planide = { command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) }
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

const MANAGED_BEGIN = '<!-- PULSAR:MAIN:BEGIN -->'
const MANAGED_END = '<!-- PULSAR:MAIN:END -->'

/**
 * The always-loaded instruction for a *main* session (not a subagent): the
 * Council's understand-first rule, then the tracker. Codex/Cursor/Gemini main
 * sessions never adopt the council-subagent persona, so this is where "the
 * Council asks first" and "keep the board in sync" actually reach them.
 */
function mainSessionBlock(home: string): string {
  return [
    '## PulsarIDE — orchestrate as The Council, and keep the board live',
    '',
    'Before diving into a non-trivial task, act as **The Council** (Pulse Agent\'s',
    'orchestrator). These four steps are the default way you work here, not an option:',
    '',
    '1. **Understand first.** Restate the actual request in one sentence. If it is genuinely',
    '   ambiguous or underspecified, say what is unclear and **ask one clarifying question**',
    '   before you start — a misread request executed perfectly is still wrong. (Skip the',
    '   question only when the intent is already unambiguous.)',
    '2. **Put it on the board, before you write any code.** Call the `planide` MCP tool',
    '   `get_board` to see the real state, then `add_item` (status `todo`) for what was just',
    '   asked — one item per real piece of work, not one giant item. This is step 2 of every',
    '   task, not an afterthought: the user watches the Tracker tab to see that you understood',
    '   the request, so an empty board while you are working reads as nothing happening.',
    '3. **Route.** Name the Pulse Agent team + the specific specialist(s) that fit, then adopt',
    '   that persona. There are 100 team leads (installed) routing to 5,050 named specialists —',
    '   read a specialist\'s file on demand and adopt it inline. Never repeat a failed approach.',
    '4. **Work the board as the work happens, and validate before you claim.**',
    '   `set_item` to `wip` when you start it, `works` once it genuinely works, `done` when it',
    '   is finished and closed out (finished work must not sit in `works` — they are different',
    '   columns), `broken` when it fails; `add_fix` the moment you hit a bug; `mark_fixed` when',
    '   the user says it is solved; `add_milestone` for the phases of a bigger plan;',
    '   `add_version` when you ship. Verify before you claim — do not green-wash.',
    '',
    'Design work: if the `od` CLI (OpenDesign) is on PATH, use it rather than hand-rolling',
    'HTML -- it renders prototypes, dashboards, decks and documents from a brief and exports',
    'real HTML/PDF/PPTX/MP4. The IDE\'s Open Design sidebar tab wires it into your agent over',
    'MCP. If `od` is missing, say so instead of pretending; do not install it yourself.',
    '',
    'Reverse-engineering toolkit is installed at `' + join(configDir(home), 'tools', 'reverse-engineering') + '`',
    '(re-triage.sh, ghidra/frida/x64dbg drivers, fuzz-driver.sh, linux-unpack.sh) — use it for',
    'binary/RE work.',
    '',
    '## The `planide` tracker tools',
    '',
    'Every project opened in PulsarIDE has a board at `<project>/.planide/state.json`, shown',
    'live in the IDE Tracker tab. Keeping it current is part of the job, in the same turn the',
    'fact appears — you never need to be asked. Pass `project` = the project\'s absolute path',
    'to every call. The board is created for you on first use, so it always works.',
    '',
    '- `get_board` — read it first, every task.',
    '- `add_item` — the user asks / you plan a step → status `todo`.',
    '- `set_item` — you start it → `wip`;  it works → `works`;  finished → `done`;  fails → `broken`.',
    '- `add_fix` — a bug (problem + where);  `mark_fixed` — the user says it is solved.',
    '- `add_milestone` / `set_milestone` — the phases of a bigger plan (the Roadmap tab).',
    '- `add_version` — a release you shipped.',
    '- `clean_doc` — run it on every markdown/text document you write, before you call it',
    '  finished. Models emit invisible watermark characters (zero-width joiners, bidi',
    '  controls, Unicode tag characters, lookalike spaces) that survive copy-paste and',
    '  corrupt diffs, filenames and shell commands. It strips those and leaves real content',
    '  — punctuation, emoji, non-Latin scripts — untouched.',
    '',
    '- **Before you say "done" or "please test", update the board first**, so what it shows',
    '  matches what you just claimed.',
    '- Only report what is real; never green-wash. `verified`/`locked` stay the user\'s — you',
    '  cannot set them, by design.',
    ''
  ].join('\n')
}


/**
 * Antigravity's own native mechanism: a Skill. Antigravity does NOT read
 * `~/.gemini/agents/` the way Gemini CLI does (different product, shared config
 * dir), so without this it only ever saw Pulse Agent through the merged
 * GEMINI.md block. A Skill is auto-discovered and activated when a task matches
 * its `description`, which is the closest thing Antigravity has to Claude Code's
 * subagent routing.
 *
 * Path verified in ThePunisher-Agent's own installer (deploy_antigravity_skill):
 * `~/.gemini/config/skills/<name>/SKILL.md`, which is the global location across
 * all three Antigravity flavours (IDE, CLI, AGY).
 *
 * Additive, not a replacement: the GEMINI.md block stays, because it is always
 * loaded while a Skill is only pulled in when it matches.
 */
function deployAntigravitySkill(home: string, block: string): string | null {
  try {
    const dir = join(home, '.gemini', 'config', 'skills', 'pulse-agent')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'SKILL.md')
    writeFileSync(
      path,
      [
        '---',
        'name: pulse-agent',
        'description: >-',
        '  Pulse Agent — the orchestrator for any non-trivial software engineering task:',
        '  coding, debugging, testing, reverse engineering, security, web and API work,',
        '  DevOps, code review, brainstorming and research. Routes to the right specialist,',
        '  refuses to repeat a failed approach, verifies before it claims, and keeps the',
        "  project's PulsarIDE board current as it works. Use for every real development",
        '  task, not only unusual ones.',
        '---',
        '',
        block,
        ''
      ].join('\n')
    )
    return path
  } catch {
    return null
  }
}

/**
 * Cursor's persona. Cursor has no verified USER-scope rules location -- its
 * documented mechanism is a project-scoped `.cursor/rules/*.mdc` -- so this is
 * written per project rather than once into $HOME. `alwaysApply: true` is what
 * makes it load without being @-mentioned, which matters because Cursor has no
 * task-based auto-routing at all.
 *
 * Gated on the project already having a board, exactly like agent-events.ts:
 * this writes into the user's own repository, so a project they never tracked is
 * left completely alone rather than gaining a file they did not ask for.
 */
export function deployCursorRule(projectPath: string, home: string = homedir()): boolean {
  try {
    if (!existsSync(join(projectPath, '.planide', 'state.json'))) return false
    const dir = join(projectPath, '.cursor', 'rules')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'pulse-agent.mdc'),
      [
        '---',
        'description: Pulse Agent — orchestration and the PulsarIDE board',
        'alwaysApply: true',
        '---',
        '',
        mainSessionBlock(home),
        ''
      ].join('\n')
    )
    return true
  } catch {
    return false
  }
}

/** Merge our managed block into a main-session context file, reconcile-not-accumulate. */
function mergeManagedBlock(path: string, block: string): boolean {
  try {
    let text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const managed = `${MANAGED_BEGIN}\n${block}\n${MANAGED_END}`
    if (text.includes(MANAGED_BEGIN) && text.includes(MANAGED_END)) {
      text = text.split(MANAGED_BEGIN)[0] + managed + (text.split(MANAGED_END)[1] ?? '')
    } else {
      text = (text.trim() ? text.trimEnd() + '\n\n' : '') + managed + '\n'
    }
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, text)
    return true
  } catch {
    return false
  }
}

/**
 * Register the planide tracker MCP for every embedded agent that reads a
 * user-scope config — Claude Code, Codex CLI, Cursor, and Gemini CLI/Antigravity
 * — and merge the main-session context (Council understand-first + tracker) into
 * each tool's always-loaded memory file so the *main* session gets it without an
 * @-mention. Returns true if any MCP registration wrote.
 */
function registerTrackerForAllAgents(home: string): boolean {
  const claude = registerPlanideMcp(home)
  const codex = registerPlanideMcpCodex(home)
  registerPlanideMcpCursor(home)
  const gemini = registerPlanideMcpGemini(home)
  const block = mainSessionBlock(home)
  mergeManagedBlock(join(home, '.codex', 'AGENTS.md'), block)
  mergeManagedBlock(join(home, '.claude', 'CLAUDE.md'), block)
  mergeManagedBlock(join(home, '.gemini', 'GEMINI.md'), block)
  // Antigravity's own native surface, on top of the shared GEMINI.md block.
  deployAntigravitySkill(home, block)
  return claude || codex || gemini
}

/**
 * Provision a self-contained Python venv with graphify + fastmcp, so the
 * knowledge-graph memory and the planide MCP server work with no manual `pip
 * install` and without touching the user's own Python. Best-effort and
 * non-blocking: the install runs detached in the background (a first launch pays
 * nothing, and it can never delay or break startup). Idempotent — it skips once
 * the venv python exists. If python3, `venv`, or the network is missing, it
 * simply never appears and the graceful fallbacks apply (the `plan` CLI is pure
 * stdlib; the memory sync still writes Data + the Obsidian note without a graph).
 */
function ensurePyEnv(home: string): boolean {
  try {
    const dir = pyEnvDir(home)
    if (existsSync(pyEnvPython(home))) return true // already provisioned
    const sysPy = process.platform === 'win32' ? 'python' : 'python3'
    try {
      execFileSync(sysPy, ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true })
    } catch {
      return false // no system python to build the venv from
    }
    mkdirSync(configDir(home), { recursive: true })
    const log = openSync(join(configDir(home), 'pyenv-setup.log'), 'a')
    const pip =
      process.platform === 'win32' ? join(dir, 'Scripts', 'pip.exe') : join(dir, 'bin', 'pip')
    // One detached step: create the venv, then install into it. Fire-and-forget.
    const shell = process.platform === 'win32' ? 'cmd' : '/bin/sh'
    const flag = process.platform === 'win32' ? '/c' : '-c'
    const cmd = `${sysPy} -m venv "${dir}" && "${pip}" install --disable-pip-version-check -q graphifyy fastmcp`
    const child = spawn(shell, [flag, cmd], {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true
    })
    child.unref()
    return true
  } catch {
    return false // never break startup over the optional memory backend
  }
}

/** Best-effort: is graphify actually installed? (for a status line, not a gate) */
export function graphifyAvailable(): boolean {
  try {
    execFileSync('graphify', ['--version'], { stdio: 'ignore', timeout: 4000, windowsHide: true })
    return true
  } catch {
    return false
  }
}
