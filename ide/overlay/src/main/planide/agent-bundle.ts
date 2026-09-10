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
 *  * Content-gated: it redeploys only when the shipped bundle actually differs
 *    from what was last written, so a normal launch pays nothing.
 *  * Reconcile-not-accumulate: it tracks exactly what it wrote in a marker file
 *    and removes only those on redeploy. It never touches an agent, skill or hook
 *    the user configured themselves.
 *  * It can never break startup — the whole thing is wrapped, and a failure is
 *    logged and swallowed.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  statSync,
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
  /**
   * Fingerprint of the bundle that was actually deployed. See bundleSignature.
   * Optional because a marker written before this existed has none -- which is
   * exactly the stale case it fixes, so its absence forces one redeploy.
   */
  signature?: string
  agents: string[] // absolute paths we wrote
  skills: string[] // skill names we deployed into ~/.claude/skills
  hooks: string[] // absolute hook-script paths we wrote
  tracker?: string // deployed tracker root we own
  mcp?: string[] // MCP server names we registered at user scope
  /** Vendored libraries we deployed (agency-agents, design/threeui). */
  libraries?: string[]
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
 * Appended to every deployed team-lead body (Claude Code, Gemini CLI, Codex,
 * Qwen Code) so
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
 * Every home-relative directory this build deploys agent content into. Part of
 * the freshness fingerprint (see bundleSignature) and the reason a newly
 * supported tool triggers exactly one redeploy on every existing install.
 */
const DEPLOY_TARGETS = [
  '.claude/agents',
  '.claude/skills',
  '.codex/agents',
  '.gemini/agents',
  '.qwen/agents',
  '.qwen/skills'
] as const

/**
 * A fingerprint of what this app actually ships, used to decide whether a
 * redeploy is needed.
 *
 * This replaces comparing `manifest.bundle_version`, which was a number someone
 * had to remember to bump -- and did not. It was last raised for v0.22.0, so
 * every bundle change after that (most visibly the 100 specialist files added
 * in v0.34.0) was gated behind a version that never moved: an existing install
 * hit `already at 2.0.0`, returned early, and never wrote them. Users then had
 * agents pointed at a specialists directory that did not exist on their disk,
 * which is exactly how it was reported. A forgotten constant should not be able
 * to do that, so freshness is now derived from the content itself.
 *
 * Cheap on purpose: path + size of every file in the directories that matter,
 * plus the manifest's own bytes. That catches an added, removed or edited file
 * without reading any of them in full at every launch.
 *
 * DEPLOY_TARGETS is in there for the mirror-image case: the bundle is byte for
 * byte the same, but this build writes it somewhere the last one did not. Adding
 * Qwen Code was exactly that -- not one file under agent-bundle/ changed, so
 * without this every existing install would have kept skipping the deploy and
 * ~/.qwen would have stayed empty. Deriving it from the target list rather than a
 * hand-bumped constant means the next tool added is covered by having been
 * added, which is the same reason this function exists at all.
 *
 * It walks the whole tree rather than each directory's top level, which is the
 * fix for a second, quieter version of the same bug: the shallow listing could
 * only see `skills/<name>` and `tracker/mcp` as entries, never what changed
 * INSIDE them. A new file in a nested directory -- a skill's own SKILL.md, a new
 * module beside the tracker's MCP server, one more role in a division of the
 * agency-agents library -- left the signature identical, so an existing install
 * decided it was current and never wrote it. Measured at 913 files in 5 ms, so
 * walking it all costs nothing worth trading correctness for.
 */
function bundleSignature(root: string): string {
  const parts: string[] = [`targets:${DEPLOY_TARGETS.join(',')}`]
  try {
    parts.push(readFileSync(join(root, 'manifest.json'), 'utf8'))
  } catch {
    /* no manifest -- the other entries still fingerprint the bundle */
  }
  /** Every file under `abs`, as `relative/path:size`, sorted so it is stable. */
  const walk = (abs: string, rel: string, depth: number): void => {
    // Depth cap: a symlink loop inside a vendored library must not hang startup.
    if (depth > 12) return
    // Explicitly Dirent[]: inferring from readdirSync picks its Buffer overload.
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      parts.push(`${rel}:absent`)
      return
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childAbs = join(abs, entry.name)
      const childRel = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(childAbs, childRel, depth + 1)
        continue
      }
      let size = -1
      try {
        size = statSync(childAbs).size
      } catch {
        /* vanished mid-scan -- record it as unreadable rather than fail */
      }
      parts.push(`${childRel}:${size}`)
    }
  }
  for (const dir of ['agents', 'specialists', 'skills', 'tracker', 'hooks', 'tools', 'agency-agents', 'design']) {
    walk(join(root, dir), dir, 0)
  }
  return createHash('sha1').update(parts.join('\n')).digest('hex')
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
    // Same shape as the venv above: optional, detached, never a gate. Opt-out
    // aware, so a user who turned ECC off does not get it back on next launch.
    if (opts.provisionPyEnv !== false) ensureEcc(home)
    const alreadyTracked = existsSync(join(configDir(home), 'tracker', 'mcp', 'planide-mcp.mjs'))
    let mcpWired = alreadyTracked ? registerTrackerForAllAgents(home) : false

    // Redeploy whenever the shipped bundle differs from what was last written --
    // by content, not by a version constant someone has to remember to bump.
    const signature = bundleSignature(root)
    if (!opts.force && prev && prev.signature === signature) {
      return skip(`already at ${manifest.bundle_version}`, mcpWired, alreadyTracked)
    }

    // Reconcile: remove what a previous deploy of ours wrote, ours only.
    if (prev) {
      for (const p of prev.agents) rmSync(p, { force: true })
      for (const name of prev.skills) {
        // Both roots: a skill we stopped shipping has to go from Qwen's copy too,
        // or an update leaves it behind for one tool and not the other.
        rmSync(join(home, '.claude', 'skills', name), { recursive: true, force: true })
        rmSync(join(home, '.qwen', 'skills', name), { recursive: true, force: true })
      }
      if (prev.tracker) rmSync(prev.tracker, { recursive: true, force: true })
      for (const lib of prev.libraries ?? []) rmSync(lib, { recursive: true, force: true })
    }

    // --- agents: team leads -> Claude Code, Gemini CLI, Codex, Qwen Code -- //
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
    // Qwen Code: same `<dir>/<name>.md` subagent shape as Gemini CLI and Claude
    // Code (frontmatter `name` + `description`, optional `tools`/`model`), read
    // from `~/.qwen/agents`. Verified against the published qwen-code bundle's
    // own loader, which lists `.md` files under
    // `join(Storage.getGlobalQwenDir(), AGENT_CONFIG_DIR)` with
    // AGENT_CONFIG_DIR = 'agents' -- not inferred from it being a Gemini fork.
    const qwenAgents = join(home, '.qwen', 'agents')
    mkdirSync(claudeAgents, { recursive: true })
    mkdirSync(geminiAgents, { recursive: true })
    mkdirSync(codexAgents, { recursive: true })
    mkdirSync(qwenAgents, { recursive: true })

    /**
     * Exactly one copy of this roster, and it is the one this app ships.
     *
     * PulsarIDE's bundle IS ThePunisher-Agent's roster, renamed to Pulse Agent
     * and kept current with the app. Someone who also ran that project's
     * standalone installer has the identical 101 team leads in these very
     * directories under a `thepunisher-` prefix -- and because our prefix is
     * `pulse-`, the two do not overwrite, they ADD.
     *
     * Claude Code budgets ~15k tokens for agent descriptions. One roster costs
     * ~10.1k (measured off these files). Two costs ~20.3k, which puts Claude
     * Code over the limit -- that is how "subagents suddenly stopped working"
     * happens: the roster is not broken, it is too big to load.
     *
     * This used to keep theirs and skip OURS. That held the budget but was the
     * wrong way round: PulsarIDE then never deployed the agent it ships, so the
     * app kept answering as "ThePunisher" and no rename or update we made ever
     * reached the user. Reported exactly that way, and it is why this changed.
     *
     * So we supersede: drop the older roster, write ours. Only a file whose
     * NAME carries that prefix AND whose CONTENT is that generated roster is
     * touched, so a hand-written agent that happens to share the prefix
     * survives. Nothing is lost -- it is the same roster under a new name, and
     * re-running ThePunisher-Agent's own installer restores its copies.
     */
    const supersedeForeignRoster = (dir: string): number => {
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return 0
      }
      let removed = 0
      for (const name of names) {
        if (!/^thepunisher-.+\.(md|toml)$/.test(name)) continue
        const file = join(dir, name)
        try {
          const body = readFileSync(file, 'utf8')
          // The generated roster names itself two ways: the activation banner it
          // instructs the persona to print, and its own frontmatter/TOML name.
          const isGeneratedRoster =
            body.includes('ThePunisher —') ||
            /^name:\s*thepunisher-/m.test(body) ||
            /^name\s*=\s*"thepunisher-/m.test(body)
          if (!isGeneratedRoster) continue
          rmSync(file)
          removed += 1
        } catch {
          /* unreadable or already gone -- leave it alone */
        }
      }
      return removed
    }
    const superseded =
      supersedeForeignRoster(claudeAgents) +
      supersedeForeignRoster(geminiAgents) +
      supersedeForeignRoster(codexAgents) +
      supersedeForeignRoster(qwenAgents)
    if (superseded > 0) {
      console.info(
        `[pulsar] replaced ${superseded} older ThePunisher-Agent roster file(s) with the Pulse ` +
          'Agent roster this app ships -- two copies of one roster exceed the description budget'
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
      writeFileSync(claudePath, mdOut)
      wroteAgents.push(claudePath)
      writeFileSync(geminiPath, mdOut)
      wroteAgents.push(geminiPath)
      writeFileSync(codexPath, toToml(mdOut))
      wroteAgents.push(codexPath)
      const qwenPath = join(qwenAgents, base)
      writeFileSync(qwenPath, mdOut)
      wroteAgents.push(qwenPath)
    }

    // --- skills: curated set incl. orchestration -> Claude Code ----------- //
    const skillsSrc = join(root, 'skills')
    const skillNames = existsSync(skillsSrc)
      ? readdirSync(skillsSrc).filter((d) => existsSync(join(skillsSrc, d, 'SKILL.md')))
      : []
    // Qwen Code reads global skills from `~/.qwen/skills/<name>/SKILL.md` --
    // same manifest name and same one-directory-per-skill layout Claude Code
    // uses, so the bundled set is copied verbatim to both. Verified against the
    // published qwen-code bundle (SKILLS_CONFIG_DIR = 'skills' under the global
    // qwen dir, manifest `SKILL.md`), not assumed from the Gemini fork.
    for (const skillRoot of [join(home, '.claude', 'skills'), join(home, '.qwen', 'skills')]) {
      mkdirSync(skillRoot, { recursive: true })
      for (const name of skillNames) {
        const dest = join(skillRoot, name)
        rmSync(dest, { recursive: true, force: true })
        cpSync(join(skillsSrc, name), dest, { recursive: true })
      }
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
    deploySpecialists(home, root)
    // Vendored libraries: the agency-agents role library and the ThreeUI design
    // components. Deployed on every real deploy, so an update that changes them
    // lands too -- bundleSignature covers both directories, so a change to either
    // is itself what triggers the redeploy.
    const libraries = ['agency-agents', join('design', 'threeui')]
      .map((rel) => deployLibrary(home, root, rel))
      .filter((p): p is string => p !== null)

    const marker: Marker = {
      bundle_version: manifest.bundle_version,
      signature,
      agents: wroteAgents,
      skills: skillNames,
      hooks: hookWired ? [join(configDir(home), 'hooks')] : [],
      tracker: trackerRoot ?? undefined,
      mcp: mcpWired ? ['planide'] : [],
      libraries
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

  // --- the agent's own plan, onto the board ------------------------------- //
  // `PostToolUse` with an exact `TodoWrite` matcher: verified against
  // code.claude.com/docs/en/hooks.md, that event hands the hook `tool_name`,
  // `tool_input` (the whole revised list) and the session's `cwd`. So each time
  // the agent re-plans, the board can be brought level with it.
  const todoScript = join(hookSrc, 'todo-sync.mjs')
  if (existsSync(todoScript)) {
    const todoDest = join(hookDir, 'todo-sync.mjs')
    cpSync(todoScript, todoDest)
    // A launcher rather than an inline command: the runner needs environment
    // (Electron has to be told to behave as Node), and quoting that inside a
    // JSON command string differs per platform and is easy to get subtly wrong.
    // A one-line script keeps settings.json holding nothing but a path.
    const stable = findStableNode()
    const runner = stable ?? process.execPath
    const asNode = stable ? '' : 'ELECTRON_RUN_AS_NODE=1 '
    let launcher: string
    if (onWindows) {
      launcher = join(hookDir, 'todo-sync.cmd')
      writeFileSync(
        launcher,
        '@echo off\r\n' +
          (stable ? '' : 'set ELECTRON_RUN_AS_NODE=1\r\n') +
          'set NODE_NO_WARNINGS=1\r\n' +
          `"${runner}" "${todoDest}"\r\n`
      )
    } else {
      launcher = join(hookDir, 'todo-sync.sh')
      writeFileSync(
        launcher,
        `#!/usr/bin/env bash\nexec env ${asNode}NODE_NO_WARNINGS=1 "${runner}" "${todoDest}"\n`
      )
      try {
        chmodSync(launcher, 0o755)
      } catch {
        /* non-fatal on filesystems without exec bits */
      }
    }
    const post = (hooks.PostToolUse ?? []) as unknown[]
    const keptPost = post.filter((entry) => {
      if (typeof entry !== 'object' || entry === null) return true
      const inner = (entry as { hooks?: unknown[] }).hooks ?? []
      return !inner.some(
        (h) =>
          typeof h === 'object' &&
          h !== null &&
          String((h as { command?: string }).command ?? '').includes('todo-sync')
      )
    })
    keptPost.push({ matcher: 'TodoWrite', hooks: [{ type: 'command', command: launcher, timeout: 15 }] })
    hooks.PostToolUse = keptPost
  }

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

/**
 * Deploy the specialist roster, one file per team.
 *
 * The team leads carry an instruction that a named specialist is not separately
 * spawnable and must be read off disk and adopted inline -- 5,050 descriptions
 * are over 20x Claude Code's budget, so only the 101 leads are registered. That
 * instruction needs something to point at: without this, routing names a
 * specialist that the lead then cannot find, and the whole layer is
 * documentation for a thing that is not on the machine.
 */
function deploySpecialists(home: string, root: string): string | null {
  const src = join(root, 'specialists')
  if (!existsSync(src)) return null
  const dest = join(configDir(home), 'specialists')
  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  return dest
}

/**
 * Deploy a vendored library directory verbatim (agency-agents, design/threeui).
 *
 * Same shape as the specialists deploy: a straight mirror to a stable path the
 * agents are told about, replaced wholesale each time so a removed upstream file
 * does not linger. Returns the destination, or null when the bundle does not
 * carry it (an older bundle, or a partial one).
 *
 * These are read off disk and adopted inline. They are deliberately NOT
 * registered as individual subagents -- 274 more `description` fields would blow
 * Claude Code's ~15k budget and break subagents everywhere, which this project
 * has already shipped once (v0.26.0). See agency-agents/ATTRIBUTION.md.
 */
function deployLibrary(home: string, root: string, rel: string): string | null {
  const src = join(root, rel)
  if (!existsSync(src)) return null
  const dest = join(configDir(home), rel)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
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
  // The team leads already tell agents to call these; without registration the
  // instruction pointed at a server that did not exist.
  const tools = toolsMcpLaunch(home)
  if (tools) {
    servers['pulsar-tools'] = { type: 'stdio', command: tools.command, args: tools.args, env: tools.env }
  }
  const meshy = meshyMcpLaunch(home)
  if (meshy) servers.meshy = { type: 'stdio', command: meshy.command, args: meshy.args, env: meshy.env }
  else delete servers.meshy
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
    // Prefer a real `node` on PATH, everywhere -- not only on AppImage, which is
    // all this used to cover.
    //
    // The app's own binary does work as Node (ELECTRON_RUN_AS_NODE), but it is a
    // ~200 MB Electron executable, and an agent starting an MCP server gives it
    // a startup timeout measured in seconds. On Windows, where a first launch
    // also means Defender scanning that whole binary, that is a real race -- and
    // losing it looks exactly like the report that led here: every planide tool
    // call failing with "Transport closed", tools resolved and registered, the
    // process simply gone. A system node starts in milliseconds and cannot lose
    // that race.
    //
    // It is also the more durable path. process.execPath is an ephemeral
    // `/tmp/.mount_*` on AppImage (already the reason this existed), and on
    // Windows it moves when the app is reinstalled elsewhere -- either way an
    // agent in a terminal is left pointing at a runtime that is gone. A node on
    // PATH survives both, and survives the app not running at all.
    //
    // Verified, not assumed: findStableNode only returns an absolute path that
    // exists and reports major >= 18. The server is zero-dependency pure Node,
    // so any modern node runs it. No node, or too old a node -> the app binary,
    // which is still correct, just slower to start.
    const stableNode = findStableNode()
    if (stableNode) return { command: stableNode, args: [nodeServer] }
    return { command: process.execPath, args: [nodeServer], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  // Only reachable before the bundle has ever deployed (or if it was deleted).
  const venvPy = pyEnvPython(home)
  const py = existsSync(venvPy) ? venvPy : process.platform === 'win32' ? 'python' : 'python3'
  return { command: py, args: [join(configDir(home), 'tracker', 'mcp', 'planide_mcp.py')] }
}

/**
 * A stable absolute `node` on PATH, new enough to run the tracker server, or
 * null. Only used on an AppImage, where the app's own execPath is an ephemeral
 * mount (see mcpLaunch). Verified rather than trusted: an absolute path that
 * exists and reports a major version >= 18, so a `node` shim or an ancient one
 * can never be handed to an agent as the tracker runtime.
 */
function findStableNode(): string | null {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const found = execFileSync(finder, ['node'], { encoding: 'utf8', timeout: 4000, windowsHide: true })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const cand of found) {
      if (!existsSync(cand)) continue
      const version = execFileSync(cand, ['--version'], { encoding: 'utf8', timeout: 4000, windowsHide: true }).trim()
      const major = Number.parseInt(version.replace(/^v/, ''), 10)
      if (Number.isFinite(major) && major >= 18) return cand
    }
  } catch {
    /* no usable node on PATH -- fall back to the app binary as Node */
  }
  return null
}

/**
 * How an agent should launch the pulsar-tools MCP server.
 *
 * Same Electron-as-Node trick as the tracker: zero install steps, cannot be
 * broken by the user's Python. Returns null when the file is not deployed yet,
 * so a caller registers nothing rather than a command that cannot start.
 */
/**
 * Meshy's own MCP server, when a key has been set.
 *
 * 3D generation is a paid API, so this cannot be pre-installed the way the rest
 * is: with no key the server exits complaining about a missing MESHY_API_KEY,
 * which every agent would show as a broken tool. So it is registered only once a
 * key exists, and removed again when the key is cleared -- which is why every
 * caller deletes the entry in the else branch rather than leaving a stale one.
 *
 * Invocation taken from Meshy's own README, not guessed: `npx -y
 * @meshy-ai/meshy-mcp-server` with the key inside an `env` block -- their
 * troubleshooting section is explicit that it must not go in `args` -- wrapped
 * in `cmd /c` on Windows, which is their documented fix for `spawn npx ENOENT`.
 */
function meshyMcpLaunch(home: string): McpLaunch | null {
  const key = readSetting(home, 'meshyApiKey')
  if (!key) return null
  const pkg = '@meshy-ai/meshy-mcp-server'
  return process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', '-y', pkg], env: { MESHY_API_KEY: key } }
    : { command: 'npx', args: ['-y', pkg], env: { MESHY_API_KEY: key } }
}

/** One string setting out of the shared settings file, or ''. */
function readSetting(home: string, key: string): string {
  try {
    const raw = readFileSync(join(configDir(home), 'settings.json'), 'utf8')
    const value = (JSON.parse(raw) as Record<string, unknown>)[key]
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}

export type MeshyStatus = { configured: boolean; hint: string }

/** Whether a key is set, and enough of it to recognise -- never the whole key. */
export function meshyStatus(home: string = homedir()): MeshyStatus {
  const key = readSetting(home, 'meshyApiKey')
  return { configured: key !== '', hint: key ? `${key.slice(0, 8)}\u2026${key.slice(-4)}` : '' }
}

/**
 * Save (or clear) the Meshy key and re-register every agent immediately.
 *
 * Re-registering here rather than at the next launch is the point: a key typed
 * into the IDE that only takes effect after a restart reads as not working.
 */
export function setMeshyKey(key: string, home: string = homedir()): MeshyStatus {
  const path = join(configDir(home), 'settings.json')
  let settings: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
    } catch {
      /* unreadable -- start clean rather than refuse to save */
    }
  }
  const trimmed = String(key || '').trim()
  if (trimmed) settings.meshyApiKey = trimmed
  else delete settings.meshyApiKey
  mkdirSync(configDir(home), { recursive: true })
  writeConfigAtomic(path, JSON.stringify(settings, null, 2))
  registerTrackerForAllAgents(home)
  return meshyStatus(home)
}

function toolsMcpLaunch(home: string): McpLaunch | null {
  const server = join(configDir(home), 'tracker', 'mcp', 'pulsar-tools-mcp.mjs')
  if (!existsSync(server)) return null
  return { command: process.execPath, args: [server], env: { ELECTRON_RUN_AS_NODE: '1' } }
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
    // Every server we own, not just the tracker. Codex only ever got `planide`,
    // so an agent there had the board but none of pulsar-tools -- no route_task,
    // no ui_find, no ecc_find, no anti-loop check. Which is the one CLI the user
    // actually runs, so that gap was the whole toolkit missing.
    const ours: { name: string; launch: McpLaunch }[] = [{ name: 'planide', launch: mcpLaunch(home) }]
    const tools = toolsMcpLaunch(home)
    if (tools) ours.push({ name: 'pulsar-tools', launch: tools })
    const meshy = meshyMcpLaunch(home)
    if (meshy) ours.push({ name: 'meshy', launch: meshy })

    // Strip every block of ours (including a meshy left behind by a cleared
    // key), keep everything else verbatim, then append the current set.
    const mine = new Set(['planide', 'pulsar-tools', 'meshy'])
    const kept: string[] = []
    let skipping = false
    for (const line of text.split(/\r?\n/)) {
      const header = line.match(/^\s*\[([^\]]+)\]/)
      if (header) {
        const name = header[1]
        const server = name.startsWith('mcp_servers.') ? name.slice('mcp_servers.'.length).split('.')[0] : ''
        skipping = mine.has(server)
      }
      if (!skipping) kept.push(line)
    }
    const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const blocks = ours.map(({ name, launch }) => {
      const envBlock = launch.env
        ? Object.entries(launch.env).map(([k, v]) => `${k} = "${esc(v)}"`).join('\n')
        : ''
      return (
        `[mcp_servers.${name}]\ncommand = "${esc(launch.command)}"\n` +
        `args = [${launch.args.map((a) => `"${esc(a)}"`).join(', ')}]\n` +
        (envBlock ? `\n[mcp_servers.${name}.env]\n${envBlock}\n` : '')
      )
    })
    const body = kept.join('\n').replace(/\s+$/, '')
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, (body ? body + '\n\n' : '') + blocks.join('\n'))
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
    const tools = toolsMcpLaunch(home)
    if (tools) {
      servers['pulsar-tools'] = { command: tools.command, args: tools.args, env: tools.env }
    }
    const meshy = meshyMcpLaunch(home)
    if (meshy) servers.meshy = { command: meshy.command, args: meshy.args, env: meshy.env }
    else delete servers.meshy
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * Register the `planide` MCP for opencode in `~/.config/opencode/opencode.json`.
 *
 * opencode is one of the agents Orca runs, and its config is genuinely NOT the
 * Claude shape -- verified against opencode's own docs source
 * (packages/web/src/content/docs/mcp-servers.mdx and config.mdx) rather than
 * assumed: servers live under `mcp` (not `mcpServers`), a local one is typed
 * `"type": "local"`, the command and its arguments are ONE array, and the
 * environment key is `environment` (not `env`). Global config is
 * `~/.config/opencode/opencode.json`.
 *
 * Reconcile-not-accumulate, same as every other agent here: only our own keys
 * are written, and an unparseable config (it may legally be JSONC with comments)
 * is left completely alone rather than clobbered.
 */
function registerPlanideMcpOpenCode(home: string): boolean {
  try {
    const path = join(home, '.config', 'opencode', 'opencode.json')
    let config: Record<string, unknown> = {}
    if (existsSync(path)) {
      try {
        config = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
      } catch {
        // Comments are legal here; a file we cannot parse is not ours to rewrite.
        return false
      }
    }
    const servers = (config.mcp ??= {}) as Record<string, unknown>
    const launch = mcpLaunch(home)
    servers.planide = {
      type: 'local',
      command: [launch.command, ...launch.args],
      enabled: true,
      ...(launch.env ? { environment: launch.env } : {})
    }
    const tools = toolsMcpLaunch(home)
    if (tools) {
      servers['pulsar-tools'] = {
        type: 'local',
        command: [tools.command, ...tools.args],
        enabled: true,
        ...(tools.env ? { environment: tools.env } : {})
      }
    }
    const meshy = meshyMcpLaunch(home)
    if (meshy) {
      servers.meshy = {
        type: 'local',
        command: [meshy.command, ...meshy.args],
        enabled: true,
        ...(meshy.env ? { environment: meshy.env } : {})
      }
    } else {
      delete servers.meshy
    }
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * opencode's global rules file, but only when the user already has one.
 *
 * opencode reads `~/.config/opencode/AGENTS.md` and, per its own docs, falls
 * back to `~/.claude/CLAUDE.md` when that file does not exist. Our block is
 * already in the latter, so creating the former would gain nothing and would
 * actively COST the user: it would switch opencode off the Claude file and
 * silently drop everything else they keep there. So we only merge into it when
 * it already exists, and otherwise leave the fallback doing its job.
 */
function mergeOpenCodeRules(home: string, block: string): void {
  const path = join(home, '.config', 'opencode', 'AGENTS.md')
  if (!existsSync(path)) return
  mergeManagedBlock(path, block)
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
  return registerPlanideMcpSettingsJson(join(home, '.gemini', 'settings.json'), home)
}

/**
 * Qwen Code is a fork of Gemini CLI and keeps the same user-scope
 * `settings.json` with a top-level `mcpServers` map, under its own `~/.qwen`
 * directory. Verified against the real published @qwen-code/qwen-code package
 * rather than assumed from the fork relationship: `QWEN_DIR = '.qwen'`,
 * `Storage.getGlobalQwenDir()` joined with `'settings.json'`, and the loader
 * reading `userSettings.mcpServers[serverName]`.
 */
function registerPlanideMcpQwen(home: string): boolean {
  return registerPlanideMcpSettingsJson(join(home, '.qwen', 'settings.json'), home)
}

/**
 * Antigravity does NOT read `~/.gemini/settings.json`.
 *
 * It shares the `~/.gemini` directory with Gemini CLI, which is exactly why
 * this was wrong for so long: registering the Gemini CLI settings file looked
 * like it covered Antigravity too, and it never did. Antigravity keeps its own
 * MCP config -- the 2.0 IDE, the `agy` CLI and the SDK all read one central
 * `~/.gemini/config/mcp_config.json` (antigravity.google/docs/cli/mcp). Same
 * top-level `mcpServers` map, different file. So every planide/pulsar-tools
 * tool was simply absent in Antigravity: not failing, not registered.
 *
 * That it is under `~/.gemini/config/` is corroborated by where Antigravity's
 * own Skills live -- `~/.gemini/config/skills/<name>/SKILL.md`, which
 * deployAntigravitySkill already writes and which does work. The skill landed;
 * the tools never did.
 *
 * Pre-migration installs read `~/.gemini/antigravity-cli/mcp_config.json`
 * instead (google-antigravity/antigravity-cli#60, which reports MCP servers
 * loading from there and being ignored at project scope). Written only when
 * that directory already exists, so a machine that never had the older layout
 * does not gain a stray directory -- the same rule deployCursorRule follows for
 * `~/.cursor`.
 *
 * Project scope is deliberately not written: per that same issue a project-local
 * `mcp_config.json` is read and then silently discarded, so writing one would
 * look like wiring and do nothing.
 */
function registerPlanideMcpAntigravity(home: string): boolean {
  let wrote = registerPlanideMcpSettingsJson(
    join(home, '.gemini', 'config', 'mcp_config.json'),
    home
  )
  const legacyDir = join(home, '.gemini', 'antigravity-cli')
  if (existsSync(legacyDir)) {
    wrote = registerPlanideMcpSettingsJson(join(legacyDir, 'mcp_config.json'), home) || wrote
  }
  return wrote
}

/** The shared writer for all of them: only our own keys are touched. */
function registerPlanideMcpSettingsJson(path: string, home: string): boolean {
  try {
    let config: Record<string, unknown> = {}
    if (existsSync(path)) {
      try {
        config = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
      } catch {
        // A malformed settings.json is that tool's own state — never clobber it.
        return false
      }
    }
    const servers = (config.mcpServers ??= {}) as Record<string, unknown>
    const launch = mcpLaunch(home)
    servers.planide = { command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) }
    const tools = toolsMcpLaunch(home)
    if (tools) {
      servers['pulsar-tools'] = { command: tools.command, args: tools.args, env: tools.env }
    }
    const meshy = meshyMcpLaunch(home)
    if (meshy) servers.meshy = { command: meshy.command, args: meshy.args, env: meshy.env }
    else delete servers.meshy
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
/**
 * Is ECC (github.com/affaan-m/ECC) actually installed as a Claude Code plugin?
 *
 * ECC is a large third-party operator layer -- 68 agents and 286 skills -- and
 * it is installed through its own official channel, never bundled here. Two
 * reasons, both real: its own README asks people not to run unofficial mirrors,
 * and 68 more agent descriptions on top of our 100 team leads would walk
 * straight into the ~15k description budget that has broken subagents in this
 * project twice already.
 *
 * So the Council is told about it only when it is genuinely on the machine.
 * A section describing a tool you do not have is pure cost in an always-loaded
 * block, and worse, it invites reaching for something that is not there.
 * Path verified against the real Claude Code CLI (2.1.266), not assumed: adding
 * a marketplace writes `~/.claude/plugins/marketplaces/<name>` and records it in
 * `~/.claude/plugins/known_marketplaces.json`.
 */
function eccInstalled(home: string): boolean {
  return existsSync(eccCatalogueDir(home))
}

function mainSessionBlock(home: string): string {
  return [
    '## PulsarIDE — orchestrate as The Council, and keep the board live',
    '',
    'Before diving into a non-trivial task, act as **The Council** (Pulse Agent\'s',
    'orchestrator). These four steps are the default way you work here, not an option:',
    '',
    '**Say who is answering, every time.** The first line of your response, whenever you are',
    'working under this instruction, must be exactly:',
    '',
    '    🔴 Pulse Agent — Council',
    '',
    'on its own line, before anything else — and when you take on a team or specialist role,',
    'put that name there instead (`🔴 Pulse Agent — Reverse Engineering Command`). Never omit',
    'it. The team-lead subagents each carry this same rule, but a main session is not a',
    'subagent: without this line there is no way to tell whether any of this reached you at',
    'all, and "it never even gets called" is the report that follows. Printing the banner is',
    'not decoration, it is the only evidence the user gets.',
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
    '**Check what is already installed before you hand-roll anything.** Everything below is',
    'on this machine right now -- not something to go and fetch. Match the work to the row',
    'and open it; writing it from scratch instead is the most common way this setup gets',
    'wasted, and "it never used any of it" is the report that follows:',
    '',
    '  3D / shader / animated visual   call ui_find("...") -- never hand-write WebGL',
    '                                  before you have looked',
    '  build or audit a UI             skills: ui-design, ui-verification, ui-animation',
    '  rebuild an existing site        the ai-website-cloner template (MIT): clone',
    '                                  Mood-Global-Services/How-to-Clone-Website, point it at',
    '                                  the URL, it extracts tokens and assets first',
    '  what to build, not how          skill: product-design',
    '  a diagram of the system         Archify (below) -- validate, then render',
    '  review a diff / tidy your own   skills: pr-reviewer, tidy',
    '  accessibility / DX / type / SEO skills: ax-audit, dx-audit, typography-audit, seo',
    '  a role no team lead covers      agency-agents (274 roles, below)',
    '  a named specialist              specialists/<team-slug>.md, adopted inline',
    '',
    'If a row fits and you did not open the thing it names, say why in one line. Silently',
    'hand-rolling what is already installed is the failure this table exists to stop.',
    '',
    'Specialists: each of the 100 teams lists its named specialists (core roster + growth',
    'pool, 5,372 in total) in `' + join(configDir(home), 'specialists') + '/<team-slug>.md`.',
    'Only the 101 team leads are registered as native subagents -- 5,050 descriptions are',
    'over 20x the budget -- so to act as a specialist, read its team file and take that role',
    'inline, printing that name in the activation banner. `README.md` there indexes the teams.',
    '',
    'Reverse-engineering toolkit is installed at `' + join(configDir(home), 'tools', 'reverse-engineering') + '`',
    '(re-triage.sh, ghidra/frida/x64dbg drivers, fuzz-driver.sh, linux-unpack.sh) — use it for',
    'binary/RE work.',
    '',
    // Only when it is really there -- see eccInstalled.
    ...(eccInstalled(home)
      ? [
          'ECC is on this machine: 354 third-party operator/harness entries (CI, repo hygiene,',
          'security review, incidents, migrations, language-specific review). It is deliberately',
          'NOT loaded — as a plugin it would cost ~40,600 tokens of every session — so it sits on',
          'disk and you fetch from it instead:',
          '',
          '    ecc_find("<the task, in your words>")   -> names + descriptions, ranked',
          '    ecc_read("<exact name>")                -> the whole file, follow it inline',
          '',
          'Call `ecc_find` when the work is operating the project rather than building it, and',
          'nothing in the table above already covers it. Then judge what comes back: each match',
          'is marked `strong` or `weak`, and weak means it shares a word with your task, not a',
          'subject — read the description before following one, and drop it if it is not really',
          'about this. ECC does not cover everything, and a Pulse Agent team is the better',
          'answer more often than not.',
          '',
          'You stay the orchestrator and the board stays the record: following an ECC entry does',
          'not excuse you from `add_item`/`set_item`. Name the entry you used, so where the',
          'approach came from is visible.',
          ''
        ]
      : []),
    '## When you are going in circles',
    '',
    'The `pulsar-tools` anti-loop now watches two different things. It still blocks a',
    'repeat of an approach that already failed here. It also counts how many DIFFERENT',
    'approaches have failed on the SAME problem: at four it returns `escalate`, and that',
    'is not a suggestion. Stop proposing a fifth, say plainly what you have ruled out and',
    'what you now believe the problem is, and ask the user what they want. Four dead ends',
    'means the problem is not understood, and a person can fix that where another attempt',
    'cannot. Call `record_anti_loop_failure` the moment something fails, or none of this',
    'can see anything.',
    '',
    'The other half of that memory is `record_solution`. Call it the moment something',
    'actually starts working, with what fixed it. Two things follow: the dead ends this',
    'problem went through stop blocking future work in that area, and every later session',
    'that asks about the same problem is told it is already solved and how -- so settled',
    'work does not get re-solved, and does not get quietly undone. `check_anti_loop`',
    'returns that as `alreadySolved`; when you see it, confirm the thing is genuinely',
    'broken again before you change anything.',
    '',
    'Your own plan is on the board too. The step list you build to work through a task is',
    'mirrored into the project board as it changes -- planned steps appear, the one you are',
    'on shows as in progress, finished ones move to `works` (never confirmed for you). So',
    'keep the plan honest and current, because it is now what the user watches.',
    '',
    'For work that genuinely warrants an adversarial second opinion -- a risky refactor, a',
    'fix that keeps coming back -- the bundled `graph-engineer` skill runs one model as',
    'orchestrator and another as implementer/reviewer in a self-correcting cycle. Its own',
    'author calls it design-stage and not yet battle-tested, so offer it for that kind of',
    'work and say what it is; do not make it the default path for ordinary tasks.',
    '',
    '## The agency-agents role library (274 roles, 19 divisions)',
    '',
    'Installed at `' + join(configDir(home), 'agency-agents') + '`, one `.md` per role',
    'across engineering, design, marketing, security, product, testing, game development,',
    'GIS, healthcare, finance, spatial computing and more (`divisions.json` indexes them).',
    'Use one when a task calls for a specialisation the team leads do not cover -- an',
    'incident commander, a pricing strategist, a level designer. Read that role file and',
    'adopt it inline for the task; they are NOT separately spawnable subagents (274 more',
    'descriptions would blow the subagent budget and break dispatch for everything, which',
    'this project has shipped once already). Same rule as the specialist roster.',
    'Reach for one when it genuinely fits the work -- not as a ceremony on every task.',
    '',
    '## Design: ThreeUI components',
    '',
    '44 self-contained React + three.js shader/3D components are installed. Before you',
    'hand-write WebGL, a canvas animation or a "wow" hero, call:',
    '',
    '    ui_find("<the visual you want>")   -> matching components + what they are',
    '    ui_read("<exact name>")            -> the whole component, to copy and adapt',
    '',
    'Use the tool, not the directory listing. The names are things like `bell-field`,',
    '`bookshelf`, `brand-orbs` -- nothing in them says which one is an animated',
    'background, which is exactly why this library kept going unused while WebGL got',
    'written from scratch next to it. `ui_find` searches ThreeUI\'s own descriptions.',
    '',
    'They need `three` as a dependency, and some reference demo assets that were not',
    "vendored -- substitute the project's own. Two upstream routes are deliberately not",
    "wired in: ThreeUI's remote MCP server (`https://threeui.com/api/mcp`) and `npx",
    '@designcodeio/threeui-cli add <name>`, both needing a paid account and a browser',
    'sign-in. Offer either only if the user asks for the live catalog or Pro components.',
    '',
    '## Shipping, design and audit skills (mblode/agent-skills)',
    '',
    '25 skills installed under `' + join(home, '.claude', 'skills') + '` covering the part of',
    'shipping that code review does not: whether the loading states exist, whether the type',
    'scale holds, and whether half the diff is AI slop. Reach for them by name:',
    '',
    '  shipping      planning, pr-reviewer, pr-creator, pr-babysitter, tidy, autoship',
    '  design/UI     product-design, ui-design, ui-verification, ui-animation,',
    '                presentation-creator',
    '  audits        ax-audit (accessibility), dx-audit, typography-audit, seo',
    '  architecture  codebase-architecture, scaffold-nextjs, scaffold-cli,',
    '                multi-tenant-architecture',
    '  writing       docs-writing, readme-creator, eli5',
    '  authoring     agents-md, agent-skills-creator, save-md',
    '',
    'They overlap with skills already here, so pick on scope rather than on name: `ui-design`',
    'builds and audits the React/Tailwind artifact, `product-design` decides what to build,',
    '`ui-verification` measures it in a real browser. Use `pr-reviewer` on a diff someone',
    'else wrote and `tidy` on your own before you hand it over.',
    '',
    'Why they are named here at all: Claude Code keeps every skill NAME in its listing but',
    'shortens DESCRIPTIONS to fit a budget of about 1% of the context window, dropping the',
    'least-used ones first. With 77 skills installed that truncation is real, so a skill can',
    'be present and still not match a request on description alone. This list is loaded with',
    'your instructions and is not subject to that budget -- so when the work matches one of',
    'the lines above, open the skill by name instead of waiting to be matched into it.',
    '',
    '## Diagrams: Archify',
    '',
    'Archify is installed at `' + join(home, '.claude', 'skills', 'archify') + '` and runs on',
    'the IDE\'s own Node with nothing to install:',
    '',
    '  node <archify>/bin/archify.mjs deliver <type> <input.json> <output.html> \\',
    '       --quality showcase --repo-root <project> --json',
    '',
    'Use `deliver --quality showcase`, not bare `render`. Showcase is a gate: it reports all',
    '9 artifact checks and refuses anything with composition errors or warnings, and it is',
    'the difference between a box-and-arrow sketch and something worth opening. `validate`',
    'first, with the same `--quality showcase`, and fix what it names.',
    '',
    'Types: architecture, workflow, sequence, dataflow, lifecycle. The schema is strict, so',
    'do not invent it: copy `<archify>/examples/*.<type>.json` for the exact shape and put',
    "this project's real topology in it. Four fields carry most of what makes an artifact",
    'worth looking at, and they are the ones that get skipped:',
    '',
    '  meta.quality_profile   set it to `showcase` — showcase acceptance checks for it',
    '  meta.views             guided views: named chapters a reader can play through',
    '  cards                  the summary panels under the diagram (per concern)',
    '  <component>.sublabel   the second line in a node: `FastAPI :8000`, `Browser/Mobile`',
    '',
    'Other commands worth reaching for, all installed:',
    '',
    '  compare architecture <base.json> <head.json> <out.html> --quality showcase',
    '      Before / Delta / After of two snapshots, with what was added, removed, changed,',
    '      moved and rerouted. This is the one to produce before a merge that moves',
    '      architecture. Keep both snapshots in the diagrams directory.',
    '  guide "<scenario>" --json     which diagram type actually fits, when unsure',

    '  brands "<product>" --json     the real mark for a named product, never guessed',
    '  visual-check <out.html> --json  the artifact renders as intended',
    '',
    'Write everything to `<project>/.planide/diagrams/`: the JSON as',
    '`<name>.<type>.json` with its artifact beside it as `<name>.<type>.html`, and a delta',
    'as `<name>.delta.html`. That directory is exactly what the IDE\'s Archify tab lists —',
    'anything put elsewhere is invisible.',
    '',
    'Real 3D assets: when a `meshy` MCP server is present, its tools generate actual 3D',
    'models, textures and rigged characters from a description. It only exists when the',
    'user has put a Meshy API key in the Archify tab, so check for the tools rather than',
    'assuming; if the work needs a real model and they are absent, say so and point at that',
    'field instead of substituting a placeholder.',
    '',
    '**Offer this per project, do not wait to be asked.** A project with real architecture',
    'and no diagram in that directory is a gap: say what you would draw and make it. Draw',
    'what the code really does — inspect it first; an invented topology drawn beautifully is',
    'worse than no diagram. Put it on the board like any other work (`add_item` when you',
    'plan it, `set_item` `works` when it renders).',
    '',
    '## The `planide` tracker tools',
    '',
    'Every project opened in PulsarIDE has a board at `<project>/.planide/state.json`, shown',
    'live in the IDE Tracker tab. Keeping it current is part of the job, in the same turn the',
    'fact appears — you never need to be asked. Pass `project` = the project\'s absolute path',
    'to every call. The board is created for you on first use, so it always works.',
    '',
    '- `sync_plan` — every time your plan changes, send the whole plan: each step with',
    '  its state. Steps are matched on their text, so a revised plan moves what moved and',
    '  adds what is new instead of duplicating anything. In Claude Code a hook does this',
    '  from TodoWrite automatically; everywhere else this call IS the mechanism, so a plan',
    '  you never sync is a Tracker that never moves.',
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
 * Gated twice, because this writes into the user's own repository.
 *
 * On the project already having a board, exactly like agent-events.ts: a
 * project they never tracked is left alone rather than gaining a file they did
 * not ask for.
 *
 * And on Cursor actually being installed. `~/.cursor` is Cursor's own user
 * directory -- it exists once Cursor has run, and not otherwise. Without this
 * check every tracked project grew a `.cursor/` folder whether or not the user
 * had ever opened Cursor, which is litter in someone else's repository.
 */
export function deployCursorRule(projectPath: string, home: string = homedir()): boolean {
  try {
    if (!existsSync(join(projectPath, '.planide', 'state.json'))) return false
    if (!existsSync(join(home, '.cursor'))) return false
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

/**
 * Why the tracker stopped being updated, on this machine, right now.
 *
 * "The agents do not update the board any more" is a report about a chain, not
 * a component: the bundle deploys the MCP server, each tool's own config has to
 * name it, the server has to actually start under whatever runtime it was
 * registered with, and the board file has to be writable. Every link works on a
 * clean install -- verified end to end -- so a break is something about one
 * machine, and none of it is visible from the outside. Guessing at it produces
 * exactly the speculative fix this project has a rule against.
 *
 * So: check each link for real. The server is not merely looked for on disk, it
 * is launched with the exact command an agent was told to use and asked for its
 * tool list, because "registered" and "runnable" fail separately and the fix
 * differs. Read-only and bounded -- a hung runtime resolves as `serverRuns:
 * false` after the timeout instead of hanging the panel that called it.
 */
export type TrackerAgentWiring = {
  id: string
  label: string
  /** Where this tool keeps user-scope MCP config. */
  configPath: string
  configExists: boolean
  /** The `planide` server is named in it. */
  registered: boolean
}

export type TrackerHealth = {
  ok: boolean
  serverPath: string
  serverPresent: boolean
  command: string
  args: string[]
  serverRuns: boolean
  toolCount: number
  agents: TrackerAgentWiring[]
  /** null when no project was passed. */
  boardWritable: boolean | null
  /** Plain-language description of the first broken link, if any. */
  problem: string | null
}

/** Does this tool's own config name our server? Shape differs per tool. */
function planideRegisteredIn(path: string): boolean {
  try {
    if (!existsSync(path)) return false
    const text = readFileSync(path, 'utf8')
    if (path.endsWith('.toml')) return /\[mcp_servers\.planide\]/.test(text)
    const config = JSON.parse(text || '{}') as {
      mcpServers?: Record<string, unknown>
      mcp?: Record<string, unknown>
    }
    // opencode nests its servers under `mcp`; everyone else uses `mcpServers`.
    // Checking only the latter would call a correctly-wired opencode unwired,
    // which now raises a banner rather than being merely cosmetic.
    return Boolean(config.mcpServers?.planide || config.mcp?.planide)
  } catch {
    return false
  }
}

/** Launch the registered command and ask it for its tools. Bounded. */
function probeMcpServer(
  launch: McpLaunch,
  timeoutMs = 6000
): Promise<{ runs: boolean; tools: number; why: string }> {
  return new Promise((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    // What the runtime said on its way out. "Transport closed" is all an agent
    // reports when this process dies, which is true and useless -- the reason is
    // on stderr and in the exit code, and nobody was collecting either.
    let stderr = ''
    const finish = (runs: boolean, tools: number, why = ''): void => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      resolve({ runs, tools, why: why || stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400) })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(launch.command, launch.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(launch.env ?? {}) },
        windowsHide: true
      })
    } catch (err) {
      resolve({ runs: false, tools: 0, why: err instanceof Error ? err.message : String(err) })
      return
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    timer = setTimeout(
      () => finish(false, 0, `no answer within ${Math.round(timeoutMs / 1000)}s -- the runtime is too slow to start`),
      timeoutMs
    )
    child.on('error', (err) => finish(false, 0, `could not start ${launch.command}: ${err.message}`))
    child.on('exit', (code) => finish(false, 0, `the server exited (code ${code ?? 'unknown'}) before answering`))
    let buf = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } }
          if (msg.id === 2 && Array.isArray(msg.result?.tools)) {
            finish(true, msg.result.tools.length)
            return
          }
        } catch {
          /* partial line -- wait for the rest */
        }
      }
    })
    try {
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'pulsar-health', version: '1' }
          }
        }) + '\n'
      )
      child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    } catch {
      finish(false, 0)
    }
  })
}

export async function trackerHealth(
  projectPath?: string,
  home: string = homedir()
): Promise<TrackerHealth> {
  const launch = mcpLaunch(home)
  const serverPath = join(configDir(home), 'tracker', 'mcp', 'planide-mcp.mjs')
  const serverPresent = existsSync(serverPath)

  const agents: TrackerAgentWiring[] = [
    { id: 'claude-code', label: 'Claude Code', configPath: join(home, '.claude.json') },
    { id: 'codex', label: 'Codex CLI', configPath: join(home, '.codex', 'config.toml') },
    { id: 'gemini', label: 'Gemini CLI', configPath: join(home, '.gemini', 'settings.json') },
    // Its own row, not a slash on Gemini's. Sharing ~/.gemini made one look like
    // both, and that is precisely how Antigravity went unwired without showing it.
    {
      id: 'antigravity',
      label: 'Antigravity',
      configPath: join(home, '.gemini', 'config', 'mcp_config.json')
    },
    { id: 'qwen', label: 'Qwen Code', configPath: join(home, '.qwen', 'settings.json') },
    { id: 'cursor', label: 'Cursor', configPath: join(home, '.cursor', 'mcp.json') },
    {
      id: 'opencode',
      label: 'opencode',
      configPath: join(home, '.config', 'opencode', 'opencode.json')
    }
  ].map((a) => ({
    ...a,
    configExists: existsSync(a.configPath),
    registered: planideRegisteredIn(a.configPath)
  }))

  const probe = serverPresent
    ? await probeMcpServer(launch)
    : { runs: false, tools: 0, why: 'the server file is not on disk' }

  let boardWritable: boolean | null = null
  if (projectPath) {
    try {
      const dir = join(projectPath, '.planide')
      mkdirSync(dir, { recursive: true })
      const probeFile = join(dir, `.health-${process.pid}.tmp`)
      writeFileSync(probeFile, '')
      rmSync(probeFile, { force: true })
      boardWritable = true
    } catch {
      boardWritable = false
    }
  }

  // First broken link wins: fixing a later one changes nothing while an earlier
  // one is still down, so naming them all at once sends you the wrong way.
  const wired = agents.filter((a) => a.registered)
  let problem: string | null = null
  if (!serverPresent) {
    problem = 'The tracker MCP server is not on disk. Restart PulsarIDE -- it redeploys the bundle on launch.'
  } else if (!probe.runs) {
    problem =
      `The server is on disk but did not answer when launched as \`${launch.command}\`: ` +
      `${probe.why || 'no reason reported'}. That runtime path is what every agent was handed, ` +
      'so every planide tool call fails with "Transport closed".'
  } else if (!wired.length) {
    problem = 'No agent config names the planide server. Use Repair to write it back.'
  } else if (!agents.find((a) => a.id === 'claude-code')?.registered && agents.find((a) => a.id === 'claude-code')?.configExists) {
    problem = 'Claude Code has a config but no planide entry -- it writes ~/.claude.json itself, so it can drop ours. Use Repair.'
  } else if (boardWritable === false) {
    problem = 'The board directory could not be written. Check permissions on the project folder.'
  } else {
    // A tool that is on this machine but carries no planide entry. Reported last,
    // because the links above break the tracker everywhere while this breaks it
    // in one agent -- but it must be reported, because "some agents update the
    // board and one never does" is otherwise invisible: the panel stayed green
    // off the agents that did work. Antigravity was exactly that for months.
    const unwired = agents.filter((a) => a.configExists && !a.registered)
    if (unwired.length) {
      problem =
        `${unwired.map((a) => a.label).join(', ')} ${unwired.length > 1 ? 'are' : 'is'} installed ` +
        'but the planide server is not in its config, so the board never moves there. Use Repair.'
    }
  }

  return {
    ok: problem === null,
    serverPath,
    serverPresent,
    command: launch.command,
    args: launch.args,
    serverRuns: probe.runs,
    toolCount: probe.tools,
    agents,
    boardWritable,
    problem
  }
}

/**
 * Write the planide MCP entry back into every agent's config.
 *
 * Deliberately reachable without a reinstall: these are files the agent CLIs
 * own and rewrite themselves (Claude Code rewrites ~/.claude.json on its own
 * schedule), so ours can go missing between launches through nobody's fault.
 * The deploy already does this on startup; this is the same call on demand.
 */
export function repairTrackerRegistration(home: string = homedir()): boolean {
  return registerTrackerForAllAgents(home)
}

/**
 * The repo-root `AGENTS.md`, for every agent this app does not know by name.
 *
 * The user-scope files above each reach exactly one tool, and that list can only
 * ever be the tools someone sat down and wired. AGENTS.md is the opposite: one
 * open format, stewarded by the Agentic AI Foundation, that 30+ agents already
 * read from the repository root -- Amp, Jules, Zed, Factory, Aider, Devin,
 * Windsurf, GitHub Copilot and others none of this code has ever heard of. It is
 * also a second, project-scoped route into the tools that ARE wired: Codex and
 * Qwen Code both read it (qwen-code's own bundle defines
 * AGENT_CONTEXT_FILENAME = 'AGENTS.md' and ships it in the default context list),
 * so a project opened here is covered even on a machine where the user-scope file
 * was never written.
 *
 * Same two rules as the Cursor rule next to it, for the same reason: only for a
 * project this app actually tracks (a board exists), and merged rather than
 * written -- AGENTS.md is a file the user commits, so everything outside our
 * delimiters is preserved byte for byte and only our own block is ever replaced.
 */
export function deployProjectAgentsMd(projectPath: string, home: string = homedir()): boolean {
  try {
    if (!existsSync(join(projectPath, '.planide', 'state.json'))) return false
    return mergeManagedBlock(join(projectPath, 'AGENTS.md'), mainSessionBlock(home))
  } catch {
    return false
  }
}

/** Merge our managed block into a main-session context file, reconcile-not-accumulate. */
/**
 * ThePunisher-Agent's own installer merges a delimited block into these very
 * files, and that block tells the model to answer as "ThePunisher". A user who
 * ran both installers therefore kept seeing `ThePunisher — <team>` in PulsarIDE
 * no matter how thoroughly the bundle was renamed to Pulse Agent -- reported
 * exactly that way, with a screenshot -- because this file is always-loaded
 * context for the MAIN session, which is not a subagent and so was never covered
 * by superseding the roster files.
 *
 * Same rule as supersedeForeignRoster: PulsarIDE's copy wins, and only the other
 * installer's own delimited block is removed. Anything the user wrote themselves
 * is outside those markers and is kept verbatim. Nothing is lost either -- it is
 * the same content under the new name, and re-running that installer restores it.
 */
const FOREIGN_BEGIN = '<!-- >>> ThePunisher (auto-managed installer block; edits below are replaced on reinstall) >>> -->'
const FOREIGN_END = '<!-- <<< ThePunisher <<< -->'

function dropForeignManagedBlock(text: string): string {
  const start = text.indexOf(FOREIGN_BEGIN)
  if (start === -1) return text
  const end = text.indexOf(FOREIGN_END, start)
  if (end === -1) return text
  return (text.slice(0, start) + text.slice(end + FOREIGN_END.length)).replace(/\n{3,}/g, '\n\n')
}

function mergeManagedBlock(path: string, block: string): boolean {
  try {
    let text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    text = dropForeignManagedBlock(text)
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
 * user-scope config — Claude Code, Codex CLI, Cursor, Gemini CLI/Antigravity and
 * Qwen Code — and merge the main-session context (Council + tracker) into
 * each tool's always-loaded memory file so the *main* session gets it without an
 * @-mention. Returns true if any MCP registration wrote.
 */
function registerTrackerForAllAgents(home: string): boolean {
  const claude = registerPlanideMcp(home)
  const codex = registerPlanideMcpCodex(home)
  registerPlanideMcpCursor(home)
  const gemini = registerPlanideMcpGemini(home)
  const qwen = registerPlanideMcpQwen(home)
  const antigravity = registerPlanideMcpAntigravity(home)
  const opencode = registerPlanideMcpOpenCode(home)
  const block = mainSessionBlock(home)
  mergeManagedBlock(join(home, '.codex', 'AGENTS.md'), block)
  mergeManagedBlock(join(home, '.claude', 'CLAUDE.md'), block)
  mergeManagedBlock(join(home, '.gemini', 'GEMINI.md'), block)
  // Qwen Code's user-scope context file. Its memory loader joins the global
  // `~/.qwen` dir with each entry of `currentMemoryFilename`, which defaults to
  // ['QWEN.md', 'AGENTS.md'] -- so QWEN.md alone reaches it, and writing both
  // would only load the same block twice.
  mergeManagedBlock(join(home, '.qwen', 'QWEN.md'), block)
  // opencode reads ~/.claude/CLAUDE.md and ~/.claude/skills when it has no
  // global AGENTS.md of its own, so it already has the block above. This only
  // adds it where the user keeps their own file, which turns that fallback off.
  mergeOpenCodeRules(home, block)
  // Antigravity's own native surface, on top of the shared GEMINI.md block.
  deployAntigravitySkill(home, block)
  return claude || codex || gemini || qwen || antigravity || opencode
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

/**
 * Put ECC's catalogue on disk, and nothing more.
 *
 * Installing ECC as a Claude Code plugin costs ~40,600 always-on tokens in
 * every session on every project -- Claude Code's own `plugin details`,
 * measured, not estimated -- for a library you need on maybe one task in
 * twenty. Paying that up front is the wrong shape.
 *
 * `claude plugin marketplace add` clones the whole repository and installs
 * nothing: verified against the real CLI, `plugin list` reports "No plugins
 * installed" afterwards. So the 286 skills and 68 agents sit on disk at no
 * context cost, and the Council reaches them through the `ecc_find` /
 * `ecc_read` tools on the pulsar-tools MCP server -- search the catalogue, read
 * the one file that fits, follow it inline.
 *
 * That is the same trade Pulse Agent already makes with its own 5,050
 * specialists, and it works for every agent with MCP rather than only Claude
 * Code. Anyone who does want the plugin loaded is one `plugin install ecc@ecc`
 * away, which is why the marketplace is registered rather than just cloned.
 *
 * Not vendored either way: ECC's README asks people not to run unofficial
 * mirrors, and 63 MB of someone else's plugin inside our exe is how the Windows
 * Defender flag happened once already.
 *
 * Fire-and-forget and once-only. It needs a CLI and the network, so it has to
 * be allowed to simply not happen: a failure writes a marker with the reason
 * and is never retried in a loop, and nothing depends on it.
 */
const ECC_STATE = 'ecc-install.json'
const ECC_REPO = 'https://github.com/affaan-m/ECC'

/**
 * Where the catalogue lands. This is Claude Code's own marketplace path, taken
 * from what the real CLI does on `plugin marketplace add` -- the git fallback
 * clones to the same place so `ecc_find` has one path to look in either way.
 */
function eccCatalogueDir(home: string): string {
  return join(home, '.claude', 'plugins', 'marketplaces', 'ecc')
}

type EccState = { attempted: string; ok: boolean; detail: string }

function readEccState(home: string): EccState | null {
  try {
    return JSON.parse(readFileSync(join(configDir(home), ECC_STATE), 'utf8')) as EccState
  } catch {
    return null
  }
}

/** The user turned it off (or never turned it on). Their machine, their context. */
function eccOptedOut(home: string): boolean {
  try {
    const raw = readFileSync(join(configDir(home), 'settings.json'), 'utf8')
    return (JSON.parse(raw) as { installEcc?: boolean }).installEcc === false
  } catch {
    return false
  }
}

export function setEccEnabled(enabled: boolean, home: string = homedir()): boolean {
  try {
    const path = join(configDir(home), 'settings.json')
    let settings: Record<string, unknown> = {}
    if (existsSync(path)) {
      try {
        settings = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
      } catch {
        /* unreadable -- start clean rather than refuse */
      }
    }
    settings.installEcc = enabled
    mkdirSync(configDir(home), { recursive: true })
    writeConfigAtomic(path, JSON.stringify(settings, null, 2))
    // Turning it back on clears the "already tried" marker, so the next launch
    // really does try again instead of remembering an old refusal.
    if (enabled) rmSync(join(configDir(home), ECC_STATE), { force: true })
    return true
  } catch {
    return false
  }
}

export type EccStatus = {
  installed: boolean
  optedOut: boolean
  lastAttempt: string | null
  lastError: string | null
  /** What ECC costs as it is used here: nothing until a tool is called. */
  alwaysOnTokens: number
  /** What installing the plugin would cost instead. Measured, not estimated. */
  alwaysOnTokensIfInstalled: number
}

export function eccStatus(home: string = homedir()): EccStatus {
  const state = readEccState(home)
  return {
    installed: eccInstalled(home),
    optedOut: eccOptedOut(home),
    lastAttempt: state?.attempted ?? null,
    lastError: state && !state.ok ? state.detail : null,
    // What it would cost if you installed the plugin. On disk, reached through
    // ecc_find/ecc_read, it costs nothing until a tool is actually called.
    alwaysOnTokensIfInstalled: 40637,
    alwaysOnTokens: 0
  }
}

function ensureEcc(home: string): boolean {
  try {
    if (eccOptedOut(home)) return false
    if (eccInstalled(home)) return true
    // One attempt per install. Retrying a failing network/npx call on every
    // launch is noise the user cannot act on; Repair-style re-enabling clears
    // this marker deliberately (setEccEnabled).
    if (readEccState(home)) return false

    mkdirSync(configDir(home), { recursive: true })
    const log = openSync(join(configDir(home), 'ecc-setup.log'), 'a')

    // `claude plugin marketplace add` when the CLI is here: it is the official
    // route and it also registers the marketplace, so `plugin install ecc@ecc`
    // stays one command away for anyone who does want it loaded.
    const claudeCli = process.platform === 'win32' ? 'claude.cmd' : 'claude'
    let cmd = claudeCli
    let args = ['plugin', 'marketplace', 'add', ECC_REPO]
    try {
      execFileSync(claudeCli, ['--version'], { stdio: 'ignore', timeout: 8000, windowsHide: true })
    } catch {
      // No Claude Code CLI. The clone is all our tools need, and this way Codex,
      // Cursor and Qwen users get ECC too -- they were never going to install a
      // Claude Code plugin.
      try {
        execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 8000, windowsHide: true })
      } catch {
        writeEccState(home, false, 'neither the claude CLI nor git is on PATH')
        return false
      }
      cmd = 'git'
      args = ['clone', '--depth', '1', ECC_REPO, eccCatalogueDir(home)]
      mkdirSync(dirname(eccCatalogueDir(home)), { recursive: true })
    }

    const child = spawn(cmd, args, {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true
    })
    child.unref()
    writeEccState(home, true, `${cmd} ${args[0]} started`)
    return true
  } catch (err) {
    writeEccState(home, false, err instanceof Error ? err.message : String(err))
    return false
  }
}

function writeEccState(home: string, ok: boolean, detail: string): void {
  try {
    mkdirSync(configDir(home), { recursive: true })
    writeConfigAtomic(
      join(configDir(home), ECC_STATE),
      JSON.stringify({ attempted: new Date().toISOString(), ok, detail }, null, 2)
    )
  } catch {
    /* a marker we cannot write just means one more attempt later */
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
