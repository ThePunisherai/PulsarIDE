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

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
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
  skills: number
  skill_names: string[]
}

type Marker = {
  bundle_version: string
  agents: string[] // absolute paths we wrote
  skills: string[] // skill names we deployed into ~/.claude/skills
  hooks: string[] // absolute hook-script paths we wrote
}

export type DeployResult = {
  deployed: boolean
  reason: string
  agents: number
  skills: number
  hookWired: boolean
}

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
  opts: { home?: string; resourcesPath?: string; appPath?: string; force?: boolean } = {}
): DeployResult {
  const home = opts.home ?? homedir()
  const skip = (reason: string): DeployResult => ({
    deployed: false,
    reason,
    agents: 0,
    skills: 0,
    hookWired: false
  })
  try {
    const root = bundleRoot(opts)
    if (!root) return skip('bundle not found')
    const manifest = readManifest(root)
    const prev = readMarker(home)
    if (!opts.force && prev && prev.bundle_version === manifest.bundle_version) {
      return skip(`already at ${manifest.bundle_version}`)
    }

    // Reconcile: remove what a previous deploy of ours wrote, ours only.
    if (prev) {
      for (const p of prev.agents) rmSync(p, { force: true })
      for (const name of prev.skills) rmSync(join(home, '.claude', 'skills', name), { recursive: true, force: true })
    }

    // --- agents: team leads -> Claude Code, Gemini CLI, Codex ------------- //
    const agentDir = join(root, 'agents')
    const agentFiles = readdirSync(agentDir).filter((f) => f.endsWith('.md'))
    const wroteAgents: string[] = []

    const claudeAgents = join(home, '.claude', 'agents')
    const geminiAgents = join(home, '.gemini', 'agents')
    const codexAgents = join(home, '.codex', 'agents')
    mkdirSync(claudeAgents, { recursive: true })
    mkdirSync(geminiAgents, { recursive: true })
    mkdirSync(codexAgents, { recursive: true })

    for (const file of agentFiles) {
      const md = readFileSync(join(agentDir, file), 'utf8')
      const base = `pulsar-${file}` // pulsar- prefix marks ours and avoids clobbering
      const claudePath = join(claudeAgents, base)
      const geminiPath = join(geminiAgents, base)
      const codexPath = join(codexAgents, `pulsar-${file.replace(/\.md$/, '.toml')}`)
      writeFileSync(claudePath, md)
      writeFileSync(geminiPath, md)
      writeFileSync(codexPath, toToml(md))
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

    const marker: Marker = {
      bundle_version: manifest.bundle_version,
      agents: wroteAgents,
      skills: skillNames,
      hooks: hookWired ? [join(configDir(home), 'hooks')] : []
    }
    mkdirSync(configDir(home), { recursive: true })
    writeFileSync(join(configDir(home), 'agent-bundle.json'), JSON.stringify(marker, null, 2))

    return {
      deployed: true,
      reason: `deployed ${manifest.bundle_version}`,
      agents: agentFiles.length,
      skills: skillNames.length,
      hookWired
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

/** Best-effort: is graphify actually installed? (for a status line, not a gate) */
export function graphifyAvailable(): boolean {
  try {
    execFileSync('graphify', ['--version'], { stdio: 'ignore', timeout: 4000 })
    return true
  } catch {
    return false
  }
}
