/**
 * ThePunisher agents, pre-installed.
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
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

type Manifest = {
  bundle_version: string
  team_leads: number
  /** Slugs (without .md) of the generalist team leads that deploy as native subagents. */
  core_team_leads?: string[]
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

This project may be tracked by PulsarIDE's built-in board, stored in
\`<project>/.planide/state.json\` and shown live in the IDE's Tracker tab. When it
is tracked, keeping it current is part of your job — you never need to be asked.

- **Read it first.** Call the \`planide\` MCP tool \`get_board\` (or run
  \`plan board <project>\`) before you start, so you build on the real state
  instead of guessing. Pass \`project\` = the project's absolute path to every tool.
- **Mirror the conversation onto the board, in the same turn the fact appears:**
  - The user asks for something, or you plan a step you have not started yet →
    \`add_item\` (status \`todo\`), so the plan is on the board before any code moves.
    Break a big request into several \`todo\` items.
  - You start or build something → \`set_item\` to \`wip\` (or \`add_item\` \`wip\`).
  - You get something working → \`set_item\` status \`works\` (recorded as *your*
    claim, attributed to you; the user confirms it separately — that's by design).
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
  const name = (front.match(/^name:\s*(.+)$/m)?.[1] ?? 'thepunisher-agent').trim()
  // description can be a folded (>) block; take the first line as a summary.
  const descLine = front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const desc = descLine === '>' || descLine === '|' ? (front.match(/\n\s{2,}(.+)/)?.[1] ?? '').trim() : descLine
  return { name, description: desc, body: body.trim() }
}

function toToml(md: string): string {
  const { name, description, body } = parseAgent(md)
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return (
    `name = "${esc(name)}"\n` +
    `description = "${esc(description)}"\n` +
    `developer_instructions = """\n${body.replace(/"""/g, '\\"\\"\\"')}\n"""\n`
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
    const deployedMcpScript = join(configDir(home), 'tracker', 'mcp', 'planide_mcp.py')
    const alreadyTracked = existsSync(deployedMcpScript)
    let mcpWired = alreadyTracked ? registerPlanideMcp(home, deployedMcpScript) : false

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
    // Only the CORE team leads deploy as native subagents. Deploying all 100 blows Claude
    // Code's ~15k agent-description budget (a real user hit "~36.7k tokens", after which every
    // prompt hits the context limit) -- the client counts more than the description field per
    // file, so the fix is deploying FEWER files, not shorter text. manifest.core_team_leads
    // lists the generalist entry points in ThePunisher roster order; the other 85
    // domain-vertical leads stay on disk in the bundle and are reached on demand through the
    // Council router. An older manifest without the field falls back to all (never zero), and
    // README.md is never an agent.
    const coreLeads = new Set((manifest.core_team_leads ?? []).map((s) => `${s}.md`))
    const agentFiles = readdirSync(agentDir).filter(
      (f) =>
        f.endsWith('.md') &&
        f.toLowerCase() !== 'readme.md' &&
        (coreLeads.size === 0 || coreLeads.has(f))
    )
    const wroteAgents: string[] = []

    const claudeAgents = join(home, '.claude', 'agents')
    const geminiAgents = join(home, '.gemini', 'agents')
    const codexAgents = join(home, '.codex', 'agents')
    mkdirSync(claudeAgents, { recursive: true })
    mkdirSync(geminiAgents, { recursive: true })
    mkdirSync(codexAgents, { recursive: true })

    for (const file of agentFiles) {
      const md = readFileSync(join(agentDir, file), 'utf8')
      // Append the tracker instruction to the body (never the frontmatter
      // description) so the subagent updates the board with zero token-budget cost.
      const mdOut = `${md.trimEnd()}\n${TRACKER_INSTRUCTION}`
      const base = `pulsar-${file}` // pulsar- prefix marks ours and avoids clobbering
      const claudePath = join(claudeAgents, base)
      const geminiPath = join(geminiAgents, base)
      const codexPath = join(codexAgents, `pulsar-${file.replace(/\.md$/, '.toml')}`)
      writeFileSync(claudePath, mdOut)
      writeFileSync(geminiPath, mdOut)
      writeFileSync(codexPath, toToml(mdOut))
      wroteAgents.push(claudePath, geminiPath, codexPath)
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
    if (trackerRoot) mcpWired = registerPlanideMcp(home, join(trackerRoot, 'mcp', 'planide_mcp.py'))

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
      settings = {}
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
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
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
  if (!existsSync(join(src, 'mcp', 'planide_mcp.py'))) return null

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
/**
 * Codex reads its MCP servers from ~/.codex/config.toml (verified: headroom-ai's own
 * providers/codex/install.py writes its marked section into that same file). Without this,
 * agents running in Codex have NO tracker tools at all -- add_project/add_item/get_board
 * simply do not exist for them -- so a whole project run in Codex silently produces an empty
 * board ("tracker doet helemaal niets, wordt niets aangemaakt"). Claude Code got the server
 * via ~/.claude.json below; Codex was never wired.
 *
 * Written as a DELIMITED block so a re-deploy replaces exactly our own section and never
 * touches the user's own Codex config (same merge convention this project uses for every
 * other shared config file).
 */
const CODEX_MCP_BEGIN = '# >>> PulsarIDE tracker (auto-managed) >>>'
const CODEX_MCP_END = '# <<< PulsarIDE tracker (auto-managed) <<<'

function registerPlanideMcpCodex(home: string, serverScript: string, command: string): boolean {
  try {
    const dir = join(home, '.codex')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'config.toml')
    let existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
    // Drop a previous block of ours (any position), keep everything else verbatim.
    const start = existing.indexOf(CODEX_MCP_BEGIN)
    if (start !== -1) {
      const end = existing.indexOf(CODEX_MCP_END)
      if (end !== -1) {
        existing = existing.slice(0, start) + existing.slice(end + CODEX_MCP_END.length)
      }
    }
    const tomlStr = (v: string): string => JSON.stringify(v) // TOML basic strings match JSON escaping
    const block =
      `${CODEX_MCP_BEGIN}\n` +
      `[mcp_servers.planide]\n` +
      `command = ${tomlStr(command)}\n` +
      `args = [${tomlStr(serverScript)}]\n` +
      `${CODEX_MCP_END}\n`
    const body = existing.trimEnd()
    writeFileSync(path, (body ? body + '\n\n' : '') + block)
    return true
  } catch {
    // Never let a Codex config problem break the whole bundle deploy.
    return false
  }
}

function registerPlanideMcp(home: string, serverScript: string): boolean {
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
  const venvPy = pyEnvPython(home)
  const command = existsSync(venvPy) ? venvPy : process.platform === 'win32' ? 'python' : 'python3'
  const servers = (config.mcpServers ??= {}) as Record<string, unknown>
  servers.planide = { type: 'stdio', command, args: [serverScript] }
  writeFileSync(path, JSON.stringify(config, null, 2))
  // Wire Codex too -- it is a first-class agent in this IDE and was silently missing the
  // tracker tools entirely. Best-effort: Claude Code registration still counts as success.
  registerPlanideMcpCodex(home, serverScript, command)
  return true
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
      execFileSync(sysPy, ['--version'], { stdio: 'ignore', timeout: 5000 })
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
    const child = spawn(shell, [flag, cmd], { detached: true, stdio: ['ignore', log, log] })
    child.unref()
    return true
  } catch {
    return false // never break startup over the optional memory backend
  }
}

/** Best-effort: is graphify actually installed? (for a status line, not a gate) */
export function graphifyAvailable(): boolean {
  try {
    execFileSync('graphify', ['--version'], { stdio: 'ignore', timeout: 4000 })
    return true
  } catch {
    return false
  }
}
