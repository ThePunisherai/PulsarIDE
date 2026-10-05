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
  copyFileSync,
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
import { dirname, join, resolve as resolvePath } from 'node:path'
import {
  cleanHeadroom,
  removedHeadroom,
  repairUserPath,
  type HeadroomCleanupReport,
  type HiddenExec
} from './headroom-cleanup'
import {
  disableCodexHook,
  doctorHooks,
  hookConfigs,
  testCodexHooks,
  type HookDoctorReport,
  type HookTest
} from './hook-doctor'
// The pure parts, for the tests that pin what a profile line may lose.
export { stripHeadroomLines, stripHeadroomToml } from './headroom-cleanup'

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
- **Work in the board's order.** \`next_task\` returns it: finish \`wip\` first (also
  what an earlier session left half done; after "ga door" call it with \`resume: true\`),
  then \`todo\`, then open fixes. A bug you hit
  mid-task → \`add_fix\` (it lands in Fixes > Open) and stay on what you were doing; it
  is picked up after the todo list. When your own task is done, carry on with that queue
  without being asked — \`set_item\` answers with the \`next\` item (the user's autopilot).
- **Docs go in \`docs/\`.** Never write a loose .md at the project root (README,
  CHANGELOG, AGENTS.md and the like stay there); update the existing doc on a subject
  before adding another. When the board is clear, docs/ is bundled into one
  \`docs/README.md\` — the board hands you that as an item.
- **Mirror the conversation onto the board, in the same turn the fact appears:**
  - The user asks for something, or you plan a step you have not started yet →
    \`add_item\` (status \`todo\`), so the plan is on the board before any code moves.
    Break a big request into several \`todo\` items.
  - You start or build something → \`set_item\` to \`wip\` (or \`add_item\` \`wip\`).
  - You get something working, and the project's own checks pass → \`set_item\`
    \`works\`. With the user's auto-complete on (the default) it lands as \`done\` and
    counts as finished — nobody ticks it off by hand — so report it only when it
    really works. It is recorded under your name, never as the user's own check.
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

/**
 * How a team lead works when Council dispatches it -- appended to every lead's
 * body (never the description, so it costs nothing until the lead runs).
 *
 * Three things the leads were missing, measured across all 100:
 *  - 82 were told to "hand off to" another team. A Claude Code subagent cannot
 *    start another subagent, so that handoff went nowhere: the lead either did
 *    the other team's work itself or stopped. A handoff is now a line it RETURNS,
 *    and Council -- which can dispatch -- starts the next team.
 *  - 0 knew where their own named specialists were. route_task said "the
 *    specialists directory" with no path, and a subagent does not necessarily
 *    see the main session's instructions where the path was.
 *  - 0 had a return format, so Council got prose back and had to guess what was
 *    done, what was checked and what was left.
 */
function teamContract(home: string, file: string): string {
  return [
    '',
    '## Working as a Pulse team lead',
    '',
    'Council dispatched you for one part of a task. How that works:',
    '',
    '- **Your named specialists** are in `' + join(configDir(home), 'specialists', file) + '`.',
    '  Read it when the task needs a specific one (`route_task` names the best fits), take',
    '  that role and put its name in your banner.',
    '- **You cannot start other agents.** Where this file says to hand off to another team,',
    '  finish your own part, then end with one line per handoff:',
    '  `Handoff: pulse-<team> -- <what they need from you>`. Council dispatches it.',
    '- **Return, in this order:** what you changed, what you verified (the exact command',
    '  and its result), what is left. A claim without its check is not done.',
    ''
  ].join('\n')
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
  // Antigravity's custom agents. Listed here for the reason the doc below
  // spells out: adding it changed nothing under agent-bundle/, so without this
  // entry the signature stayed identical and every existing install kept
  // skipping the deploy -- exactly what happened when Qwen Code was added, and
  // exactly what happened again here. Reported as "nog steeds zie ik niet van
  // onze council / pulse agent" after the release that was supposed to fix it.
  '.gemini/config/agents',
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
  // Identical content is not a write. Several of these configs are rewritten on
  // EVERY launch (registerTrackerForAllAgents runs before the bundle-signature
  // gate), and an atomic rename swaps the inode even when not one byte changed.
  // That is pure churn against files other tools own and watch -- most sharply
  // Codex, which records hook trust against the hook entry's content hash and
  // re-prompts "hooks need review" for anything it sees as new or changed, so a
  // needlessly rewritten ~/.codex/hooks.json is a trust hash we should never be
  // touching in the first place. Cheap guard, and it protects every caller.
  try {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return
  } catch {
    /* unreadable -- fall through and write, same as before */
  }
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

/**
 * Is `dest` already a byte-for-byte copy of the tree at `src`?
 *
 * Used to leave an unchanged skill completely untouched on redeploy: no delete,
 * no copy, so no window where an agent can see the name but not the directory.
 * Compares the relative file list and then the bytes; a mismatch anywhere is
 * enough to answer no, and any error answers no so the caller just redeploys.
 */
function sameTree(src: string, dest: string): boolean {
  const walk = (base: string, rel = '', out: string[] = []): string[] => {
    for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(base, r, out)
      else if (e.isFile()) out.push(r)
    }
    return out
  }
  try {
    if (!existsSync(dest)) return false
    const a = walk(src).sort()
    const b = walk(dest).sort()
    if (a.length !== b.length || a.some((f, i) => f !== b[i])) return false
    return a.every((f) => readFileSync(join(src, f)).equals(readFileSync(join(dest, f))))
  } catch {
    return false
  }
}

/** Python's byte-code cache: rebuilt by Python itself, never ours to ship or prune. */
const isPyCache = (name: string): boolean => name === '__pycache__'

/**
 * Make `dest` a copy of the tree at `src` without `dest` ever going missing.
 *
 * The deployed tracker used to be removed and copied back -- and the reconcile
 * removed it even earlier, so for the length of a whole redeploy (every agent,
 * four skill roots, the hooks) ~/.config/pulsaride/tracker did not exist. An
 * agent that started its MCP servers in that window got MODULE_NOT_FOUND for
 * planide-mcp.mjs and pulsar-tools-mcp.mjs: reported from Antigravity as "MCP
 * Error" on both servers. A deploy that threw half-way left it gone for good,
 * because the next launch saw the same bundle signature and skipped.
 *
 * So nothing is removed first. A file that differs is staged beside its target
 * and renamed over it -- a rename that replaces is one step on POSIX and on
 * Windows (MoveFileEx, REPLACE_EXISTING), so a reader gets the old file or the
 * new one, never none. A file the bundle no longer ships goes last. `last`
 * names files written after all the others: the servers' entry points, so a
 * server that starts mid-update loads its new modules, not a new entry over
 * old modules. An unchanged file is not written at all, which is what makes
 * this cheap enough to run on every launch. Errors are per file and counted.
 */
function syncTree(
  src: string,
  dest: string,
  last: string[] = []
): { written: number; removed: number; failed: string[] } {
  const result = { written: 0, removed: 0, failed: [] as string[] }
  const files: string[] = []
  const dirs = new Set<string>()
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(src, rel), { withFileTypes: true })) {
      if (isPyCache(e.name)) continue
      const r = rel ? join(rel, e.name) : e.name
      if (e.isDirectory()) {
        dirs.add(r)
        walk(r)
      } else if (e.isFile()) {
        files.push(r)
      }
    }
  }
  walk('')
  const lastSet = new Set(last.map((p) => join(p)))
  const ordered = [...files.filter((f) => !lastSet.has(f)), ...files.filter((f) => lastSet.has(f))]

  mkdirSync(dest, { recursive: true })
  // A file where the bundle now has a directory would stop every file under it.
  for (const d of dirs) {
    const at = statSync(join(dest, d), { throwIfNoEntry: false })
    if (at && !at.isDirectory()) rmSync(join(dest, d), { force: true })
  }
  for (const rel of ordered) {
    const from = join(src, rel)
    const to = join(dest, rel)
    try {
      const current = statSync(to, { throwIfNoEntry: false })
      if (current?.isFile() && current.size === statSync(from).size && readFileSync(to).equals(readFileSync(from))) {
        continue
      }
      // A directory where the bundle now has a file: only then is anything removed first.
      if (current?.isDirectory()) rmSync(to, { recursive: true, force: true })
      mkdirSync(dirname(to), { recursive: true })
      const stage = `${to}.pulsar-${process.pid}.tmp`
      try {
        copyFileSync(from, stage)
        renameSync(stage, to)
      } catch {
        // The rename was refused (the file held open without delete sharing, an
        // antivirus hold): write it in place instead, it is still never absent.
        rmSync(stage, { force: true })
        copyFileSync(from, to)
      }
      result.written += 1
    } catch {
      result.failed.push(rel)
    }
  }

  // What the bundle no longer ships. Python's cache is left to Python.
  const keepFiles = new Set(files)
  const prune = (rel: string): void => {
    let entries
    try {
      entries = readdirSync(join(dest, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (isPyCache(e.name)) continue
      const r = rel ? join(rel, e.name) : e.name
      const keep = e.isDirectory() ? dirs.has(r) : keepFiles.has(r)
      if (keep) {
        if (e.isDirectory()) prune(r)
        continue
      }
      try {
        rmSync(join(dest, r), { recursive: true, force: true })
        result.removed += 1
      } catch {
        /* held open -- an extra file is harmless, a missing one is not */
      }
    }
  }
  prune('')
  return result
}

function configDir(home: string): string {
  return join(home, '.config', 'pulsaride')
}

/**
 * Bump to run the Windows half of the Headroom cleanup (registry, scheduled
 * tasks, running process) once more on every machine. It spawns reg/schtasks,
 * so unlike the file half it does not run on every launch.
 */
const HEADROOM_SYSTEM_PASS = 1

type HeadroomMarker = {
  systemPass: number
  last: HeadroomCleanupReport | null
  /** 1 once repairUserPath has run on a machine 0.98.0's system pass touched. */
  pathRepair?: number
}

/**
 * Removes Headroom's launch points from this machine -- see headroom-cleanup.ts
 * for what and why. The file half (shell profiles, agent configs) runs every
 * time; the Windows half runs once per HEADROOM_SYSTEM_PASS, and again whenever
 * the file half finds Headroom back, since that means its installer ran again.
 * What it did is kept in ~/.config/pulsaride/headroom-cleanup.json, and every
 * file it changed is backed up under headroom-removed/<time>/. Never throws.
 */
export async function removeHeadroom(
  home: string = homedir(),
  opts: {
    platform?: NodeJS.Platform
    exec?: HiddenExec
    appData?: string
    env?: NodeJS.ProcessEnv
    /** Folders this app puts on its own Path, never restored into the user's. */
    appFolders?: string[]
  } = {}
): Promise<HeadroomCleanupReport | null> {
  try {
    const markerPath = join(configDir(home), 'headroom-cleanup.json')
    let marker: HeadroomMarker | null = null
    try {
      marker = JSON.parse(readFileSync(markerPath, 'utf8')) as HeadroomMarker
    } catch {
      marker = null
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = {
      home,
      backupDir: join(configDir(home), 'headroom-removed', stamp),
      platform: opts.platform,
      exec: opts.exec,
      appData: opts.appData
    }
    const systemDue = (marker?.systemPass ?? 0) < HEADROOM_SYSTEM_PASS
    let report = await cleanHeadroom({ ...base, includeSystem: systemDue })
    if (!systemDue && removedHeadroom(report)) {
      // Back in a profile or config: its installer ran again, so its Windows
      // launch points may be back too. The file half finds nothing new this
      // time, only what it already reported.
      const again = await cleanHeadroom({ ...base, includeSystem: true })
      const key = (t: { action: string; where: string }): string => `${t.action} ${t.where}`
      const seen = new Set(report.traces.map(key))
      report = { ...report, traces: [...report.traces, ...again.traces.filter((t) => !seen.has(key(t)))] }
    }
    // 0.98.0 deleted a user variable whole when one entry in it was Headroom's
    // -- a whole user Path. On a machine its system pass ran on, put that back
    // once, from the environment the app is still running with.
    // A system pass run now uses the fixed rule, so there is nothing to repair.
    let pathRepair = systemDue ? 1 : (marker?.pathRepair ?? 0)
    if ((opts.platform ?? process.platform) === 'win32' && (marker?.systemPass ?? 0) >= 1 && pathRepair < 1) {
      const resources = (process as { resourcesPath?: string }).resourcesPath ?? ''
      const appFolders = opts.appFolders ?? [dirname(process.execPath), resources]
      const repaired = await repairUserPath({ exec: opts.exec, env: opts.env, exclude: appFolders })
      if (repaired) report = { ...report, traces: [...report.traces, repaired] }
      pathRepair = 1
    }
    if (systemDue || report.traces.length || pathRepair !== (marker?.pathRepair ?? 0)) {
      const next: HeadroomMarker = {
        systemPass: HEADROOM_SYSTEM_PASS,
        last: report.traces.length ? report : (marker?.last ?? null),
        pathRepair
      }
      mkdirSync(configDir(home), { recursive: true })
      writeFileSync(markerPath, `${JSON.stringify(next, null, 2)}\n`)
    }
    for (const t of report.traces) {
      const line = `[pulsaride] headroom ${t.action}: ${t.where} -- ${t.detail}`
      if (t.action !== 'manual') console.log(line)
      else console.warn(line)
    }
    return report
  } catch {
    return null
  }
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
function parseAgent(md: string): {
  name: string
  description: string
  descriptionFull: string
  body: string
} {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const front = m ? m[1] : ''
  const body = m ? m[2] : md
  const name = (front.match(/^name:\s*(.+)$/m)?.[1] ?? 'pulse-agent').trim()
  // description can be a folded (>) block; take the first line as a summary.
  const descLine = front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const folded = descLine === '>' || descLine === '|'
  const desc = folded ? (front.match(/\n\s{2,}(.+)/)?.[1] ?? '').trim() : descLine
  // ...and the whole block, joined. `description` above stops at the first line,
  // which for a folded block cuts mid-sentence ("Use PROACTIVELY as the first and
  // last" -- the half that says what the agent is FOR is on line two). Codex keeps
  // the short form it has always had; Antigravity gets the full one, because there
  // the description is what the primary agent routes on.
  const descriptionFull = folded
    ? (front
        .match(/^description:\s*[>|]\s*\n((?:\s{2,}.*(?:\n|$))+)/m)?.[1] ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim() || desc
    : desc
  return { name, description: desc, descriptionFull, body: body.trim() }
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
 * Antigravity's own custom-agent format.
 *
 * Antigravity CLI has a real subagent mechanism and we were not using it. It got
 * the merged GEMINI.md block and a Skill, but no entry in `/agents` and nothing
 * the primary agent could route to -- reported exactly that way: "in antigravity
 * cli zie ik geen pulse agent of council geleid wordt zoals in codex en claude".
 *
 * Verified against Google's own sources rather than inferred from the Gemini
 * fork, because the two products share `~/.gemini` and that is precisely how
 * this went unwired before (see registerPlanideMcpAntigravity):
 *   - google-antigravity/antigravity-cli CHANGELOG: "Custom Agents (Markdown
 *     Format) ... defining custom agents using Markdown files (`agent.md`) with
 *     YAML frontmatter and H1-delimited system prompts", supporting `mainAgent`,
 *     `subagent`, `hidden`, `inheritMcp` and `commandExecutionPolicy`.
 *   - the same CHANGELOG fixing the `/agents` panel for pointing at
 *     `~/.gemini/antigravity-cli/` "instead of `~/.gemini/config/`, ensuring
 *     users create global subagents in the location actively scanned during
 *     startup discovery" -- so the global root is `~/.gemini/config/agents/`,
 *     one directory per agent, matching the agent's own name.
 *
 * Only `subagent`/`mainAgent` are set. `model` and `commandExecutionPolicy` are
 * deliberately left off: the documented minimal example pins `model: pro` and a
 * sandbox policy, and pinning either would override the model the user actually
 * chose (Claude Opus, in the report this fixes) and narrow what the agent may
 * run. Omitted, they inherit -- per the same CHANGELOG, Markdown agents "inherit
 * ambient skills, rules, and subagents by default".
 */
function toAntigravityAgent(md: string): string {
  const { name, descriptionFull, body } = parseAgent(md)
  // A YAML double-quoted scalar. The description is a folded block upstream, so
  // it is flattened to one line first -- a raw newline would end the scalar, and
  // a stray `:` in it would otherwise be read as a new key.
  const esc = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s*\n\s*/g, ' ').trim()
  return [
    '---',
    `name: ${name}`,
    `description: "${esc(descriptionFull)}"`,
    'subagent: true',
    'mainAgent: false',
    '---',
    '',
    // The body is prose, not a heading, and the format is documented as
    // H1-delimited -- so it gets the H1 the docs' own examples use.
    '# System Prompt',
    '',
    body,
    ''
  ].join('\n')
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
    if (opts.provisionPyEnv !== false) ensureEcc(home, root)
    // Headroom off the machine -- also every launch, because the installer that
    // put it there can run again. Asynchronous and self-contained: it never
    // holds up the deploy below and never throws. Tests pass false here too, so
    // they do not touch the real registry or the real profiles.
    if (opts.provisionPyEnv !== false) void removeHeadroom(home)
    trimHookLog(home)
    // Hooks other installers left that can never run -- the "Hook failed,
    // exit code 1" Codex shows on every prompt (hook-doctor.ts).
    if (opts.provisionPyEnv !== false) runHookDoctor(home)
    // The tracker folder, every launch and before anything that can fail: every
    // agent's MCP config and every hook points into it. Only a file that differs
    // is written, so a normal launch writes nothing -- but a folder a half-done
    // deploy, a cleaner or an antivirus left incomplete is whole again, instead
    // of staying MODULE_NOT_FOUND until the next bundle change (the gate below
    // never redeploys an unchanged bundle).
    const trackerNow = deployTrackerFiles(home, root)
    const alreadyTracked = trackerNow !== null
    let mcpWired = alreadyTracked ? registerTrackerForAllAgents(home) : false

    // Redeploy whenever the shipped bundle differs from what was last written --
    // by content, not by a version constant someone has to remember to bump.
    const signature = bundleSignature(root)
    if (!opts.force && prev && prev.signature === signature) {
      return skip(`already at ${manifest.bundle_version}`, mcpWired, alreadyTracked)
    }

    // What this bundle ships, needed by the reconcile below as well as the
    // deploy further down, so work it out once before either runs.
    const skillsSrc = join(root, 'skills')
    const skillNames = existsSync(skillsSrc)
      ? readdirSync(skillsSrc).filter((d) => existsSync(join(skillsSrc, d, 'SKILL.md')))
      : []
    const shipping = new Set(skillNames)

    // Reconcile: remove what a previous deploy of ours wrote, ours only.
    if (prev) {
      // recursive: Antigravity's agents are directories, the other four are
      // files. rmSync on a directory without it throws, which would abort the
      // whole redeploy cleanup; on a file it changes nothing.
      for (const p of prev.agents) rmSync(p, { force: true, recursive: true })
      for (const name of prev.skills) {
        // ONLY skills we have stopped shipping. Deleting the ones we are about to
        // rewrite emptied every root for the whole length of the redeploy, and an
        // agent that had already listed the directory then failed to open what it
        // had just seen -- Codex reported that as "failed to read file ... (os
        // error 3)", ERROR_PATH_NOT_FOUND, on three alphabetically consecutive
        // skills: exactly how far the re-copy had got. The deploy loop below
        // updates a still-shipping skill in place instead, so it is never absent.
        if (shipping.has(name)) continue
        // Every root we deploy into: a skill we stopped shipping has to go from
        // all of them, or an update leaves it behind for one tool and not the
        // others. Keep this list in step with the deploy loop below.
        rmSync(join(home, '.claude', 'skills', name), { recursive: true, force: true })
        rmSync(join(home, '.codex', 'skills', name), { recursive: true, force: true })
        rmSync(join(home, '.qwen', 'skills', name), { recursive: true, force: true })
        rmSync(join(home, '.gemini', 'config', 'skills', name), { recursive: true, force: true })
      }
      // The tracker and the libraries are updated in place (syncTree), never
      // removed here: removing them here is what left ~/.config/pulsaride/tracker
      // missing for this whole redeploy, the MODULE_NOT_FOUND Antigravity showed
      // for planide and pulsar-tools. Only what this bundle no longer ships goes.
      const trackerDest = resolvePath(join(configDir(home), 'tracker'))
      if (prev.tracker && resolvePath(prev.tracker) !== trackerDest) {
        rmSync(prev.tracker, { recursive: true, force: true })
      }
      const shippedLibraries = new Set(
        LIBRARIES.filter((rel) => existsSync(join(root, rel))).map((rel) => resolvePath(join(configDir(home), rel)))
      )
      for (const lib of prev.libraries ?? []) {
        if (!shippedLibraries.has(resolvePath(lib))) rmSync(lib, { recursive: true, force: true })
      }
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
    // Antigravity CLI: its own custom-agent root, one DIRECTORY per agent
    // holding an `agent.md` -- not `<name>.md` like the four above, and not
    // `~/.gemini/agents` (that is Gemini CLI's; the shared ~/.gemini is exactly
    // what made this look covered when it never was). See toAntigravityAgent.
    const antigravityAgents = join(home, '.gemini', 'config', 'agents')
    mkdirSync(claudeAgents, { recursive: true })
    mkdirSync(geminiAgents, { recursive: true })
    mkdirSync(codexAgents, { recursive: true })
    mkdirSync(qwenAgents, { recursive: true })
    mkdirSync(antigravityAgents, { recursive: true })

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
      // Council is the dispatcher, not a dispatched lead, so it gets no contract.
      const contract = file === 'council.md' ? '' : teamContract(home, file)
      const mdOut = `${md.trimEnd()}\n${contract}${TRACKER_INSTRUCTION}`
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
      // Antigravity: <root>/<agent-name>/agent.md. The directory has to match the
      // agent's own name, and every team lead's frontmatter name is already
      // `pulse-<basename>`, so the two line up by construction.
      const antigravityDir = join(antigravityAgents, base.replace(/\.md$/, ''))
      mkdirSync(antigravityDir, { recursive: true })
      writeFileSync(join(antigravityDir, 'agent.md'), toAntigravityAgent(mdOut))
      // The directory, not the file: a roster change has to take the whole
      // agent with it, or `/agents` keeps listing an empty shell.
      wroteAgents.push(antigravityDir)
    }

    // --- skills: curated set incl. orchestration -> Claude Code ----------- //
    // Qwen Code reads global skills from `~/.qwen/skills/<name>/SKILL.md` --
    // same manifest name and same one-directory-per-skill layout Claude Code
    // uses, so the bundled set is copied verbatim to both. Verified against the
    // published qwen-code bundle (SKILLS_CONFIG_DIR = 'skills' under the global
    // qwen dir, manifest `SKILL.md`), not assumed from the Gemini fork.
    // Antigravity reads global skills from `~/.gemini/config/skills/<name>/SKILL.md`
    // -- the same one-directory-per-skill, `SKILL.md` layout, and the same root
    // deployAntigravitySkill already writes pulse-agent into (so the path is
    // corroborated by something that demonstrably works, not assumed). It was
    // missing here, which is the whole reason Council could never name a skill in
    // Antigravity: it was not that it would not: there were no skills on disk to
    // name, and the instructions below pointed at ~/.claude/skills, a path
    // Antigravity never reads. Reported exactly that way: "council in antigravity
    // geeft geen opdracht welke skill agent gebruikt moet worden".
    // Codex is here for the same reason Antigravity was added above, and it was
    // missing for the same reason: `$CODEX_HOME/skills` (default ~/.codex/skills)
    // is Codex's own personal-scope skills root, and SKILL.md is the portable
    // cross-agent format -- the identical folder works in ~/.claude/skills,
    // ~/.codex/skills and ~/.openclaw/skills unmodified. Until this line existed
    // Codex had ZERO skills on disk: reported as "lijkt of hij niet alles
    // aanroept vooral de design skills voor web", and visible in that session as
    // Codex reading `C:/Users/<user>/.claude/skills/tidy/SKILL.md` by absolute
    // path -- reaching a skill only through ANOTHER tool's directory, which works
    // by accident on a machine that also has Claude Code and not at all otherwise.
    for (const skillRoot of [
      join(home, '.claude', 'skills'),
      join(home, '.codex', 'skills'),
      join(home, '.qwen', 'skills'),
      join(home, '.gemini', 'config', 'skills')
    ]) {
      mkdirSync(skillRoot, { recursive: true })
      for (const name of skillNames) {
        const src = join(skillsSrc, name)
        const dest = join(skillRoot, name)
        // Never delete a skill that is already correct. A redeploy used to rm
        // then cp EVERY skill, so each one stopped existing for as long as its
        // copy took -- and an agent that reads the directory in that window sees
        // the name, then cannot open it. Codex reported exactly that, on three
        // alphabetically consecutive skills (autoship, aws-skills, ax-audit):
        // "failed to read file ... (os error 3)", which is ERROR_PATH_NOT_FOUND,
        // the directory rather than the file. It hit Codex first only because
        // ~/.codex/skills is new here; the same window was always open for the
        // other three roots.
        if (sameTree(src, dest)) continue
        // Changed skills are staged beside the target and renamed in, so the
        // gap where the skill is absent is one rename instead of a whole
        // recursive copy. Windows cannot rename onto an existing directory, so
        // the old one goes first -- that pair is as close to atomic as Node
        // gets here.
        const stage = `${dest}.pulsar-${process.pid}.tmp`
        try {
          rmSync(stage, { recursive: true, force: true })
          cpSync(src, stage, { recursive: true })
          rmSync(dest, { recursive: true, force: true })
          renameSync(stage, dest)
        } catch {
          // Staging failed (a locked file, an antivirus hold). Fall back to the
          // direct copy rather than leaving the skill missing entirely.
          rmSync(stage, { recursive: true, force: true })
          cpSync(src, dest, { recursive: true, force: true })
        }
      }
    }

    // --- memory hooks: graphify + Obsidian, per project ------------------- //
    const hookWired = wireHooks(home, root)

    // --- tracker: plan CLI + planide package + planide MCP server ---------- //
    // Deploys the built-in tracker files; the MCP registration (user scope, so an
    // agent in any project can update that project's board — reflected live in the
    // Tracker tab) is the always-run step above, refreshed here now that the files
    // are freshly (re)deployed.
    // Already synced at the top of this launch; registered again now that the
    // hooks the plan-hook wiring points at are written.
    const trackerRoot = trackerNow
    if (trackerRoot) mcpWired = registerTrackerForAllAgents(home)
    deployToolsFiles(home, root)
    deploySpecialists(home, root)
    // Vendored libraries: the agency-agents role library, the ThreeUI design
    // components and the 152-system design-system library. Deployed on every real deploy, so an update that changes them
    // lands too -- bundleSignature covers both directories, so a change to either
    // is itself what triggers the redeploy.
    const libraries = LIBRARIES
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
    command = hookCommand(dest, 'git-bash')
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
  // Any prior entry of ours (keyed on the script name) is replaced in place;
  // everyone else's stays exactly where it was.
  reconcileHookGroup(hooks, 'SessionStart', 'graphify-bootstrap', {
    hooks: [{ type: 'command', command, timeout: 30 }]
  })

  // --- where to resume, at the start of every session ---------------------- //
  // A second SessionStart entry beside the graphify bootstrap: it reads the
  // board and hands the session what is still in progress, the next todo and
  // the open fixes, in the fixed work order (resume-brief.mjs). Claude Code
  // merges additionalContext from every SessionStart hook, so the two stay
  // independent -- and this one runs on node, not python, so it works on a
  // machine the bootstrap has to skip. Written before the plan hook below,
  // because Codex and Gemini/Qwen are wired from there and get it too.
  const resumeScript = join(hookSrc, 'resume-brief.mjs')
  if (existsSync(resumeScript)) {
    const resumeDest = join(hookDir, 'resume-brief.mjs')
    cpSync(resumeScript, resumeDest)
    const launcher = writeNodeLauncher(hookDir, 'resume-brief', resumeDest, onWindows)
    reconcileHookGroup(hooks, 'SessionStart', 'resume-brief', {
      hooks: [{ type: 'command', command: hookCommand(launcher, 'git-bash'), timeout: 15 }]
    })
  }

  // --- autopilot: keep working the board without being told --------------- //
  // The brief above fires once, and every new prompt took over from it: "als
  // ik niet vraag pak wat in behandeling is op, doet hij het niet". So the same
  // script answers two more events (keep-going.mjs): the user's prompt, to mark
  // where the board stands and to answer a bare "ga door" with the item to go
  // on with, and the end of the turn, to hand over the next item instead of
  // stopping -- `{ decision: "block", reason }`, which Claude Code continues
  // the turn with (code.claude.com/docs/en/hooks.md). Gated in work-queue.mjs
  // keepGoing: the user's switch, progress, a per-turn limit, and a turn that
  // never touched the board is never followed by board work.
  const goScript = join(hookSrc, 'keep-going.mjs')
  if (existsSync(goScript)) {
    const goDest = join(hookDir, 'keep-going.mjs')
    cpSync(goScript, goDest)
    const launcher = writeNodeLauncher(hookDir, 'keep-going', goDest, onWindows)
    for (const event of ['UserPromptSubmit', 'Stop']) {
      reconcileHookGroup(hooks, event, 'keep-going', {
        hooks: [{ type: 'command', command: hookCommand(launcher, 'git-bash'), timeout: 15 }]
      })
    }
  }

  // --- docs go in docs/ ------------------------------------------------------ //
  // "In de toekomst alleen daar aanmaken": a new loose doc at a tracked
  // project's root is refused with where it belongs (docs-guard.mjs), so the
  // agent writes it there itself. `PreToolUse` on `Write` can deny with a
  // reason the agent reads (hookSpecificOutput.permissionDecision).
  const guardScript = join(hookSrc, 'docs-guard.mjs')
  if (existsSync(guardScript)) {
    const guardDest = join(hookDir, 'docs-guard.mjs')
    cpSync(guardScript, guardDest)
    const launcher = writeNodeLauncher(hookDir, 'docs-guard', guardDest, onWindows)
    reconcileHookGroup(hooks, 'PreToolUse', 'docs-guard', {
      matcher: 'Write',
      hooks: [{ type: 'command', command: hookCommand(launcher, 'git-bash'), timeout: 15 }]
    })
  }

  // --- a project stays one folder ------------------------------------------ //
  // "Nou maakt die allemaal mappen aan": Projectmanagement-v060-dev ... -v077-dev,
  // one an hour, beside the project. A shell command or write that would create
  // or fill a copy, worktree or version folder next to a tracked project is
  // refused with the reason, unless the user asked for one in that chat
  // (project-guard.mjs, rules in tracker/mcp/sibling-guard.mjs).
  const projectGuardScript = join(hookSrc, 'project-guard.mjs')
  if (existsSync(projectGuardScript)) {
    const dest = join(hookDir, 'project-guard.mjs')
    cpSync(projectGuardScript, dest)
    const launcher = writeNodeLauncher(hookDir, 'project-guard', dest, onWindows)
    reconcileHookGroup(hooks, 'PreToolUse', 'project-guard', {
      matcher: 'Bash|PowerShell|Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: hookCommand(launcher, 'git-bash'), timeout: 15 }]
    })
  }

  // --- the agent's own plan, onto the board ------------------------------- //
  // `PostToolUse` with an exact `TodoWrite` matcher: verified against
  // code.claude.com/docs/en/hooks.md, that event hands the hook `tool_name`,
  // `tool_input` (the whole revised list) and the session's `cwd`. So each time
  // the agent re-plans, the board can be brought level with it.
  const todoScript = join(hookSrc, 'todo-sync.mjs')
  if (existsSync(todoScript)) {
    const todoDest = join(hookDir, 'todo-sync.mjs')
    cpSync(todoScript, todoDest)
    const launcher = writeNodeLauncher(hookDir, 'todo-sync', todoDest, onWindows)
    reconcileHookGroup(hooks, 'PostToolUse', 'todo-sync', {
      matcher: 'TodoWrite',
      hooks: [{ type: 'command', command: hookCommand(launcher, 'git-bash'), timeout: 15 }]
    })
    // Codex and Gemini CLI/Qwen run the very same script off their own plan
    // tools -- see below.
    wireCodexPlanHook(home)
    wireGeminiPlanHook(home)
  }

  writeConfigAtomic(settingsPath, JSON.stringify(settings, null, 2))
  return true
}

/**
 * A one-line launcher that runs a hook script on node, and its path.
 *
 * A launcher rather than an inline command: the runner needs environment
 * (Electron has to be told to behave as Node), and quoting that inside a JSON
 * command string differs per platform and is easy to get subtly wrong. A
 * one-line script keeps settings.json holding nothing but a path. The name is
 * `<base>.cmd` / `<base>.sh`, which Codex's and Gemini's hook entries point at.
 */
function writeNodeLauncher(hookDir: string, base: string, script: string, onWindows: boolean): string {
  const stable = findStableNode()
  const runner = stable ?? process.execPath
  const asNode = stable ? '' : 'ELECTRON_RUN_AS_NODE=1 '
  // A hook is advisory: whatever happens inside it, the agent must never see
  // "Hook failed". Codex shows any non-zero exit right in the user's session
  // ("hook exited with code 1"), so the launcher always ends with 0 and what
  // went wrong goes to one log beside the hooks instead -- where it can be read.
  const log = join(hookDir, 'hook-errors.log')
  if (onWindows) {
    const launcher = join(hookDir, `${base}.cmd`)
    writeFileSync(
      launcher,
      '@echo off\r\n' +
        `if not exist "${runner}" exit /b 0\r\n` +
        (stable ? '' : 'set ELECTRON_RUN_AS_NODE=1\r\n') +
        'set NODE_NO_WARNINGS=1\r\n' +
        `"${runner}" "${script}" 2>>"${log}"\r\n` +
        'exit /b 0\r\n'
    )
    return launcher
  }
  const launcher = join(hookDir, `${base}.sh`)
  writeFileSync(
    launcher,
    '#!/usr/bin/env bash\n' +
      `[ -x "${runner}" ] || exit 0\n` +
      `env ${asNode}NODE_NO_WARNINGS=1 "${runner}" "${script}" 2>>"${log}"\n` +
      'exit 0\n'
  )
  try {
    chmodSync(launcher, 0o755)
  } catch {
    /* non-fatal on filesystems without exec bits */
  }
  return launcher
}

/** The shell an agent hands its hook commands to (checked in each agent's source). */
export type HookShell = 'git-bash' | 'powershell'

/** A drive-letter path every Windows shell reads unquoted (no spaces, quotes or `$`). */
const WIN_PLAIN_PATH = /^[A-Za-z]:\\[A-Za-z0-9_.\\~-]*$/
const POSIX_PLAIN_PATH = /^[A-Za-z0-9_./~+-]+$/

/**
 * The command line that starts one of our launchers, for the shell the agent
 * runs its hooks in. A bare `C:\Users\...\hook.cmd` was right for none of
 * them on every machine, and a hook whose command the shell cannot even parse
 * fails before our script starts -- so `hook-errors.log` stays empty while the
 * agent shows "hook exited with code 1":
 *  - Claude Code runs a command through Git Bash on Windows (PowerShell only
 *    without Git Bash; code.claude.com/docs/en/hooks.md "Shell form"). Bash
 *    reads the backslashes as escapes and looks for `C:UsersJax.config...`.
 *    Forward slashes are read by Git Bash and PowerShell alike.
 *  - Codex runs it through the user's shell, PowerShell on Windows
 *    (codex-rs/core session hooks config: environment.shell, `-NoProfile
 *    -Command`); Gemini CLI through PowerShell (shell-utils
 *    getShellConfiguration); Qwen Code through what `shell` names. A path
 *    with a space splits there into a command `C:\Users\Jax` that does not
 *    exist; PowerShell's call operator on a quoted path does not.
 * A plain path (the usual case) stays exactly what it was for the PowerShell
 * agents: Codex trusts a hook by its place and its command, so an unchanged
 * command stays trusted.
 */
export function hookCommand(
  launcher: string,
  shell: HookShell,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== 'win32') {
    return POSIX_PLAIN_PATH.test(launcher) ? launcher : `'${launcher.replaceAll("'", "'\\''")}'`
  }
  if (shell === 'git-bash') {
    const slashed = launcher.replaceAll('\\', '/')
    return WIN_PLAIN_PATH.test(launcher) ? slashed : `"${slashed.replace(/(["$`\\])/g, '\\$1')}"`
  }
  return WIN_PLAIN_PATH.test(launcher) ? launcher : `& '${launcher.replaceAll("'", "''")}'`
}

/**
 * Put one of our hook groups under `event`, replacing any earlier copy of it
 * (matched on `key` in the command) and keeping every other group exactly as
 * it was. Reconcile, never accumulate -- and never reorder anything.
 *
 * In place, not removed and appended: Codex records the user's trust per hook
 * POSITION (group and handler index, codex-rs/hooks discovery), so moving ours
 * to the end on every redeploy untrusted it -- and every hook after its old
 * place -- after each update, until the user approved them all again.
 */
function reconcileHookGroup(
  hooks: Record<string, unknown>,
  event: string,
  key: string,
  group: Record<string, unknown>
): void {
  const groups = (Array.isArray(hooks[event]) ? hooks[event] : []) as unknown[]
  const ours = (entry: unknown): boolean => {
    if (typeof entry !== 'object' || entry === null) return false
    const inner = (entry as { hooks?: unknown[] }).hooks ?? []
    return inner.some(
      (h) =>
        typeof h === 'object' &&
        h !== null &&
        String((h as { command?: string }).command ?? '').includes(key)
    )
  }
  const first = groups.findIndex(ours)
  if (first === -1) {
    hooks[event] = [...groups, group]
    return
  }
  // The first copy keeps its place; any duplicates an older version left go.
  hooks[event] = groups.flatMap((entry, i) => (i === first ? [group] : ours(entry) ? [] : [entry]))
}

/** The resume-brief launcher wireHooks wrote, if it is really on disk. */
function resumeLauncher(home: string): string | null {
  const path = join(configDir(home), 'hooks', process.platform === 'win32' ? 'resume-brief.cmd' : 'resume-brief.sh')
  return existsSync(path) ? path : null
}

/**
 * Keep hooks/hook-errors.log small: the launchers append every hook's stderr to
 * it, and a hook failing on every tool call would otherwise grow it for good.
 * Past 1 MB it keeps its newest 256 KB.
 */
function trimHookLog(home: string): void {
  const log = join(configDir(home), 'hooks', 'hook-errors.log')
  try {
    if (!existsSync(log) || statSync(log).size <= 1024 * 1024) return
    const text = readFileSync(log, 'utf8')
    writeFileSync(log, text.slice(-256 * 1024))
  } catch {
    /* a log we cannot trim is not worth failing a launch over */
  }
}

/**
 * Check every agent's hooks and take out of action the ones that can never
 * run; the report is kept at ~/.config/pulsaride/hook-doctor.json for the
 * Toolkit page. Backups of any changed config go under hook-doctor/<time>/.
 */
export function runHookDoctor(
  home: string = homedir(),
  opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; codexHomes?: string[] } = {}
): HookDoctorReport {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const report = doctorHooks({
    home,
    backupDir: join(configDir(home), 'hook-doctor', stamp),
    env: opts.env,
    platform: opts.platform,
    codexHomes: opts.codexHomes
  })
  try {
    mkdirSync(configDir(home), { recursive: true })
    const file = join(configDir(home), 'hook-doctor.json')
    // What was taken out stays on record until the next one; a clean run that
    // follows a fix must not erase what the fix was.
    let kept: HookDoctorReport['issues'] = []
    try {
      kept = (JSON.parse(readFileSync(file, 'utf8')) as HookDoctorReport).issues.filter((i) => i.disabled)
    } catch {
      kept = []
    }
    const issues = [...report.issues, ...kept.filter((k) => !report.issues.some((i) => i.command === k.command && i.event === k.event))]
    writeFileSync(file, `${JSON.stringify({ ...report, issues }, null, 2)}\n`)
    return { ...report, issues }
  } catch {
    return report
  }
}

/**
 * Every Codex hook, run once the way Codex runs it (testCodexHooks) -- what the
 * Toolkit's "Test hooks" shows, so a "hook exited with code 1" gets a name.
 */
export async function runHookTest(
  home: string = homedir(),
  opts: { codexHomes?: string[]; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}
): Promise<HookTest[]> {
  const report = runHookDoctor(home, opts)
  return testCodexHooks({ entries: report.codex ?? [], env: opts.env, platform: opts.platform })
}

/**
 * Turn one Codex hook off at the user's request. Only in a Codex hook file this
 * app knows -- the renderer names the file, and a name is not a licence to
 * rewrite any JSON on disk.
 */
export function turnOffCodexHook(
  target: { file: string; event: string; command: string },
  opts: { home?: string; codexHomes?: string[] } = {}
): boolean {
  const home = opts.home ?? homedir()
  const known = hookConfigs(home, opts.codexHomes)
    .filter((c) => c.agent === 'Codex')
    .map((c) => resolvePath(c.file).toLowerCase())
  if (typeof target?.file !== 'string' || !known.includes(resolvePath(target.file).toLowerCase())) return false
  if (typeof target.event !== 'string' || typeof target.command !== 'string' || !target.command) return false
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return disableCodexHook({
    file: target.file,
    event: target.event,
    command: target.command,
    home,
    backupDir: join(configDir(home), 'hook-doctor', stamp)
  })
}

/** The project-guard launcher wireHooks wrote, if it is really on disk. */
function projectGuardLauncher(home: string): string | null {
  const path = join(configDir(home), 'hooks', process.platform === 'win32' ? 'project-guard.cmd' : 'project-guard.sh')
  return existsSync(path) ? path : null
}

/** The docs-guard launcher wireHooks wrote, if it is really on disk. */
function docsGuardLauncher(home: string): string | null {
  const path = join(configDir(home), 'hooks', process.platform === 'win32' ? 'docs-guard.cmd' : 'docs-guard.sh')
  return existsSync(path) ? path : null
}

/** The autopilot launcher wireHooks wrote, if it is really on disk. */
function keepGoingLauncher(home: string): string | null {
  const path = join(configDir(home), 'hooks', process.platform === 'win32' ? 'keep-going.cmd' : 'keep-going.sh')
  return existsSync(path) ? path : null
}

/**
 * The same plan-to-board sync, for Codex, off Codex's own plan tool.
 *
 * Until this existed, Codex reached the board only if the model remembered to
 * call `sync_plan`. Claude Code never had to remember: a hook does it. That
 * asymmetry is most of what "the tracker does not update" meant for anyone whose
 * main CLI is Codex.
 *
 * Codex has the equivalent, and it is a genuine hook, not an approximation.
 * Verified against openai/codex itself (Apache-2.0) rather than a third-party
 * write-up, because the write-ups disagree with the source on the casing:
 *  - `codex-rs/hooks/src/engine/discovery.rs` loads `<config>/hooks.json` into a
 *    `HooksFile { hooks }`, keyed by event name, each event holding
 *    `{ matcher, hooks: [...] }` groups -- the same shape as Claude Code's
 *    settings.json, which is unsurprising: the engine is literally
 *    `ClaudeHooksEngine`.
 *  - `codex-rs/hooks/src/schema.rs` renames the config event names to PascalCase
 *    (`#[serde(rename = "PostToolUse")]`). The camelCase `HookEventName` in the
 *    app-server protocol schema is a different surface -- writing `postToolUse`
 *    here would simply never match.
 *  - `PostToolUseCommandInput` gives the hook `tool_name`, `tool_input` and `cwd`
 *    on stdin, and the matcher is compared against the tool name. That is exactly
 *    what the Claude Code hook already consumes, so one script serves both.
 *  - `update_plan` is a real registered tool (`update_plan_enabled` in
 *    codex-rs/core/src/config/mod.rs), and its arguments are
 *    `UpdatePlanArgs { explanation, plan: Vec<PlanItemArg { step, status }> }`
 *    with status pending / in_progress / completed.
 *
 * Reconcile-not-accumulate, and never clobber: a hooks.json we cannot parse is
 * Codex's own state and is left exactly as it is, the same rule every other
 * config writer here follows.
 */
function wireCodexPlanHook(home: string): boolean {
  try {
    const launcher = join(
      configDir(home),
      'hooks',
      process.platform === 'win32' ? 'todo-sync.cmd' : 'todo-sync.sh'
    )
    // Wired only once the script it points at is really on disk. A hook naming a
    // missing file fails on every single plan update, which is worse than none.
    if (!existsSync(launcher)) return false

    const path = join(home, '.codex', 'hooks.json')
    let config: Record<string, unknown> = {}
    if (existsSync(path)) {
      try {
        config = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
      } catch {
        return false // not ours to rewrite
      }
    }
    const hooks = (config.hooks ??= {}) as Record<string, unknown>
    // `timeoutSec`, not `timeout`: Codex's ConfiguredHookHandler names it that.
    // In place (reconcileHookGroup): Codex trusts hooks by position.
    reconcileHookGroup(hooks, 'PostToolUse', 'todo-sync', {
      matcher: 'update_plan',
      hooks: [{ type: 'command', command: hookCommand(launcher, 'powershell'), timeoutSec: 15 }]
    })
    // Where to resume, at session start -- the same brief Claude Code gets.
    // Verified against openai/codex (codex-rs/hooks/src/schema.rs): SessionStart
    // hands the hook `cwd` and reads `hookSpecificOutput.additionalContext`,
    // with deny_unknown_fields, which is exactly the shape resume-brief prints;
    // a group's matcher is optional. Codex trusts hooks per event/group/handler,
    // so this new group asks for review once and leaves the already-trusted plan
    // hook above untouched.
    const resume = resumeLauncher(home)
    if (resume) {
      reconcileHookGroup(hooks, 'SessionStart', 'resume-brief', {
        hooks: [{ type: 'command', command: hookCommand(resume, 'powershell'), timeoutSec: 15 }]
      })
    }
    // The autopilot, on the same two events Claude Code uses. Verified in
    // openai/codex codex-rs/hooks/src/schema.rs and events/stop.rs: Stop hands
    // over session_id, cwd and last_assistant_message and continues the turn on
    // `{ decision: "block", reason }`; UserPromptSubmit hands over `prompt` and
    // reads hookSpecificOutput.additionalContext. Hooks are a stable,
    // default-on Codex feature (codex-rs/features: "hooks").
    const go = keepGoingLauncher(home)
    if (go) {
      for (const event of ['UserPromptSubmit', 'Stop']) {
        reconcileHookGroup(hooks, event, 'keep-going', {
          hooks: [{ type: 'command', command: hookCommand(go, 'powershell'), timeoutSec: 15 }]
        })
      }
    }
    // A project stays one folder: Codex's shell and apply_patch pass PreToolUse
    // (codex-rs/hooks: the matcher is a regex, `apply_patch` also answers to
    // Write/Edit; deny is hookSpecificOutput.permissionDecision). A new group:
    // Codex asks once, in /hooks, to trust it -- the others keep their places.
    const keep = projectGuardLauncher(home)
    if (keep) {
      reconcileHookGroup(hooks, 'PreToolUse', 'project-guard', {
        matcher: 'Bash|apply_patch',
        hooks: [{ type: 'command', command: hookCommand(keep, 'powershell'), timeoutSec: 15 }]
      })
    }
    mkdirSync(dirname(path), { recursive: true })
    writeConfigAtomic(path, JSON.stringify(config, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * The same again for Gemini CLI and Qwen Code -- each in its own hook dialect.
 *
 * Gemini CLI (checked against its own docs/hooks/reference.md, not write-ups):
 *  - its event names are its own: `AfterTool` (not PostToolUse) on `write_todos`,
 *    `BeforeAgent` / `AfterAgent` for the user's prompt and the end of the turn,
 *    `BeforeTool` on `write_file`;
 *  - `timeout` is in MILLISECONDS (default 60000). 15 would be 15ms.
 *
 * Qwen Code is a Gemini CLI fork that took a different road for hooks, and
 * treating it as Gemini was a bug: until 0.99.2 only its SessionStart fired.
 * Checked against QwenLM/qwen-code docs/users/features/hooks.md and
 * packages/core/src/tools/todoWrite.ts:
 *  - Claude-style events: `PostToolUse` on `todo_write` (its plan tool, taking
 *    `{ todos: [{ id, content, status }] }`), `UserPromptSubmit`, `Stop`
 *    (`{ decision: "block", reason }`, last_assistant_message on stdin),
 *    `PreToolUse` on `write_file` (hookSpecificOutput.permissionDecision);
 *  - `timeout` in SECONDS -- a value of 1000 or more is still read as ms.
 * The Gemini-named groups an earlier version wrote into ~/.qwen are removed.
 */
function wireGeminiPlanHook(home: string): boolean {
  const ext = process.platform === 'win32' ? 'cmd' : 'sh'
  const launcher = join(configDir(home), 'hooks', `todo-sync.${ext}`)
  if (!existsSync(launcher)) return false
  const resume = resumeLauncher(home)
  const go = keepGoingLauncher(home)
  const guard = docsGuardLauncher(home)
  const keep = projectGuardLauncher(home)

  const flavours: { path: string; qwen: boolean }[] = [
    { path: join(home, '.gemini', 'settings.json'), qwen: false },
    { path: join(home, '.qwen', 'settings.json'), qwen: true }
  ]
  let wrote = false
  for (const { path, qwen } of flavours) {
    try {
      let config: Record<string, unknown> = {}
      if (existsSync(path)) {
        try {
          config = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
        } catch {
          continue // that tool's own state -- never clobber it
        }
      }
      const hooks = (config.hooks ??= {}) as Record<string, unknown>
      const timeout = qwen ? 15 : 15000
      // Gemini CLI always runs hooks in PowerShell on Windows; Qwen Code in
      // cmd, Git Bash or PowerShell depending on how it was started, unless a
      // hook names its shell -- so ours name PowerShell there.
      const pinShell = qwen && process.platform === 'win32'
      const cmd = (command: string): Record<string, unknown> => ({
        type: 'command',
        command: hookCommand(command, 'powershell'),
        ...(pinShell ? { shell: 'powershell' } : {}),
        timeout
      })
      const ev = qwen
        ? { plan: 'PostToolUse', planTool: 'todo_write', prompt: 'UserPromptSubmit', stop: 'Stop', write: 'PreToolUse' }
        : { plan: 'AfterTool', planTool: 'write_todos', prompt: 'BeforeAgent', stop: 'AfterAgent', write: 'BeforeTool' }
      if (qwen) {
        // What an earlier version wrote under Gemini's names: inert in Qwen.
        for (const [event, key] of [
          ['AfterTool', 'todo-sync'],
          ['BeforeAgent', 'keep-going'],
          ['AfterAgent', 'keep-going'],
          ['BeforeTool', 'docs-guard']
        ] as const) {
          dropHookGroup(hooks, event, key)
        }
      }
      reconcileHookGroup(hooks, ev.plan, 'todo-sync', { matcher: ev.planTool, hooks: [cmd(launcher)] })
      // Where to resume, at session start: both inject
      // hookSpecificOutput.additionalContext; no matcher needed.
      if (resume) reconcileHookGroup(hooks, 'SessionStart', 'resume-brief', { hooks: [cmd(resume)] })
      // The autopilot: the user's prompt and the end of the turn.
      if (go) {
        for (const event of [ev.prompt, ev.stop]) reconcileHookGroup(hooks, event, 'keep-going', { hooks: [cmd(go)] })
      }
      // Docs go in docs/: a new loose doc at the root is refused with a reason.
      if (guard) reconcileHookGroup(hooks, ev.write, 'docs-guard', { matcher: 'write_file', hooks: [cmd(guard)] })
      // A project stays one folder: shell commands and file writes beside it.
      if (keep) {
        reconcileHookGroup(hooks, ev.write, 'project-guard', {
          matcher: qwen ? 'run_shell_command|write_file|edit' : 'run_shell_command|write_file|replace',
          hooks: [cmd(keep)]
        })
      }
      mkdirSync(dirname(path), { recursive: true })
      writeConfigAtomic(path, JSON.stringify(config, null, 2))
      wrote = true
    } catch {
      /* one agent failing is not the other's problem */
    }
  }
  return wrote
}

/** Remove our hook group (matched on `key` in its command) from `event`, keeping everyone else's. */
function dropHookGroup(hooks: Record<string, unknown>, event: string, key: string): void {
  const groups = hooks[event]
  if (!Array.isArray(groups)) return
  const kept = groups.filter((entry) => {
    if (typeof entry !== 'object' || entry === null) return true
    const inner = (entry as { hooks?: unknown[] }).hooks ?? []
    return !inner.some(
      (h) => typeof h === 'object' && h !== null && String((h as { command?: string }).command ?? '').includes(key)
    )
  })
  if (kept.length) hooks[event] = kept
  else delete hooks[event]
}

/** What agents start straight from the tracker folder -- written last by syncTree. */
const TRACKER_ENTRY_POINTS = ['mcp/planide-mcp.mjs', 'mcp/pulsar-tools-mcp.mjs', 'mcp/planide_mcp.py', 'plan']

/** The vendored libraries deployed under ~/.config/pulsaride, by bundle-relative path. */
const LIBRARIES = ['agency-agents', join('design', 'threeui'), join('design', 'design-systems')]

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
  // Updated in place, never removed first (syncTree): every agent's MCP config
  // and every hook points into this folder, so it must exist at every moment.
  try {
    syncTree(src, dest, TRACKER_ENTRY_POINTS)
  } catch {
    /* unreadable bundle -- what is on disk stays, and the check below says if it is enough */
  }
  try {
    // Only when it is not executable yet: this runs on every launch, and a
    // launch with nothing to change should write nothing at all.
    if ((statSync(join(dest, 'plan')).mode & 0o111) === 0) chmodSync(join(dest, 'plan'), 0o755)
  } catch {
    /* non-fatal on filesystems without exec bits */
  }
  return existsSync(join(dest, 'mcp', 'planide-mcp.mjs')) ? dest : null
}

/** Deploy Pulse Agent's tool kits (the reverse-engineering toolkit) to a stable location. */
function deployToolsFiles(home: string, root: string): string | null {
  const src = join(root, 'tools')
  if (!existsSync(src)) return null
  const dest = join(configDir(home), 'tools')
  syncTree(src, dest)
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
  syncTree(src, dest)
  return dest
}

/**
 * Deploy a vendored library directory verbatim (agency-agents, design/threeui).
 *
 * Same shape as the specialists deploy: a straight mirror to a stable path the
 * agents are told about, updated in place (syncTree) so a removed upstream file
 * does not linger and a file an agent -- or pulsar-tools' design_find -- is
 * reading never goes missing mid-update. Returns the destination, or null when
 * the bundle does not carry it (an older bundle, or a partial one).
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
  syncTree(src, dest)
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
  const unreal = unrealMcpLaunch(home)
  if (unreal) servers.unreal = { type: 'stdio', command: unreal.command, args: unreal.args }
  else delete servers.unreal
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

/** Write one string setting into the shared settings file (or remove it). */
function writeSetting(home: string, key: string, value: string): void {
  const path = join(configDir(home), 'settings.json')
  let settings: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, unknown>
    } catch {
      /* unreadable -- start clean rather than refuse to save */
    }
  }
  const trimmed = String(value || '').trim()
  if (trimmed) settings[key] = trimmed
  else delete settings[key]
  mkdirSync(configDir(home), { recursive: true })
  writeConfigAtomic(path, JSON.stringify(settings, null, 2))
}

/**
 * Unreal Engine's MCP server, once you have pointed the IDE at your clone.
 *
 * Local by design: this one drives a running Unreal editor through the UnrealMCP
 * plugin, so it only means anything on a machine that actually has Unreal. The
 * invocation is verbatim from flopperam/unreal-engine-mcp's own LOCAL_SETUP.md
 * (`uv --directory <repo>/Python run unreal_mcp_server_advanced.py`), not
 * guessed -- there is also a hosted url+API-key variant upstream, deliberately
 * not used here.
 *
 * Registered only when the server script is really on disk, so an agent is never
 * shown a tool that cannot start. Two things stay the user's, and the Toolkit
 * says so: `uv` on PATH, and the UnrealMCP plugin enabled in the project.
 */
function unrealMcpLaunch(home: string): McpLaunch | null {
  const repo = readSetting(home, 'unrealMcpPath')
  if (!repo) return null
  const pyDir = join(repo, 'Python')
  if (!existsSync(join(pyDir, 'unreal_mcp_server_advanced.py'))) return null
  return { command: 'uv', args: ['--directory', pyDir, 'run', 'unreal_mcp_server_advanced.py'] }
}

export type UnrealStatus = { configured: boolean; path: string; ready: boolean; problem: string }

/** What the Toolkit shows: is a folder set, and is it really the right folder. */
export function unrealStatus(home: string = homedir()): UnrealStatus {
  const repo = readSetting(home, 'unrealMcpPath')
  if (!repo) return { configured: false, path: '', ready: false, problem: '' }
  const ready = existsSync(join(repo, 'Python', 'unreal_mcp_server_advanced.py'))
  return {
    configured: true,
    path: repo,
    ready,
    // Naming the file we looked for is the difference between "it does not work"
    // and knowing the wrong folder was picked.
    problem: ready ? '' : 'No Python/unreal_mcp_server_advanced.py in there — pick the folder you cloned unreal-engine-mcp into.'
  }
}

/** Point the IDE at the clone (or clear it) and re-register every agent now. */
export function setUnrealPath(path: string, home: string = homedir()): UnrealStatus {
  writeSetting(home, 'unrealMcpPath', path)
  registerTrackerForAllAgents(home)
  return unrealStatus(home)
}

const UNREAL_REPO = 'https://github.com/flopperam/unreal-engine-mcp'

/**
 * Download the Unreal MCP server into a folder you choose, then register it.
 *
 * The first version asked you to clone the repo yourself and then point at it,
 * which is the wrong half of the job to hand back: picking a folder is a thing a
 * file dialog does well, running `git clone` is not something a user should have
 * to do for a feature the IDE offers. You choose where it goes; we put it there.
 *
 * It clones into a NAMED subfolder rather than straight into the folder you
 * picked -- choosing Documents and finding it filled with a repo's contents is a
 * surprise, and an unnamed clone is impossible to recognise again later.
 *
 * Already-present is a success, not an error: re-picking the same folder simply
 * re-registers it, so this is safe to click twice.
 */
export async function installUnrealMcp(
  destDir: string,
  home: string = homedir()
): Promise<UnrealStatus> {
  const dest = String(destDir || '').trim()
  if (!dest) return unrealStatus(home)
  const target = join(dest, 'unreal-engine-mcp')
  const server = join(target, 'Python', 'unreal_mcp_server_advanced.py')
  if (existsSync(server)) return setUnrealPath(target, home)

  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 8000, windowsHide: true })
  } catch {
    return {
      configured: false,
      path: '',
      ready: false,
      problem: `git is not on PATH, so the server cannot be downloaded. Install git, or clone ${UNREAL_REPO} by hand and pick that folder.`
    }
  }

  try {
    mkdirSync(dest, { recursive: true })
  } catch {
    return { configured: false, path: '', ready: false, problem: `Cannot write to ${dest}.` }
  }

  // Bounded, because a clone is the one step here that talks to the network. A
  // stalled transfer does not fail -- it sits there, and an unbounded promise
  // means the child stays alive and whoever asked for this never gets an answer.
  // The git --version probe above already uses a timeout; this is the same rule
  // applied to the call that can actually hang.
  const CLONE_TIMEOUT_MS = 10 * 60 * 1000
  const code = await new Promise<number>((resolve) => {
    const child = spawn('git', ['clone', '--depth', '1', UNREAL_REPO, target], {
      stdio: 'ignore',
      windowsHide: true
    })
    let settled = false
    const done = (c: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(c)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone -- nothing to kill */
      }
      done(-1)
    }, CLONE_TIMEOUT_MS)
    child.on('error', () => done(-1))
    child.on('close', (c) => done(c ?? -1))
  })

  // Checking for the server file rather than trusting the exit code: a clone can
  // report success and still not be the layout we need if upstream moves it.
  if (!existsSync(server)) {
    return {
      configured: false,
      path: '',
      ready: false,
      problem: `Downloaded into ${target}, but Python/unreal_mcp_server_advanced.py is not there (git exited ${code}).`
    }
  }
  return setUnrealPath(target, home)
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
    const unrealTo = unrealMcpLaunch(home)
    if (unrealTo) ours.push({ name: 'unreal', launch: unrealTo })

    // Strip every block of ours (including a meshy or unreal left behind by a
    // cleared setting), keep everything else verbatim, then append the current set.
    const mine = new Set(['planide', 'pulsar-tools', 'meshy', 'unreal'])
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
    const unreal = unrealMcpLaunch(home)
    if (unreal) servers.unreal = { command: unreal.command, args: unreal.args }
    else delete servers.unreal
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
    const unreal = unrealMcpLaunch(home)
    if (unreal) {
      servers.unreal = {
        type: 'local',
        command: [unreal.command, ...unreal.args],
        enabled: true
      }
    } else {
      delete servers.unreal
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
    const unreal = unrealMcpLaunch(home)
    if (unreal) servers.unreal = { command: unreal.command, args: unreal.args }
    else delete servers.unreal
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
 * ECC is a large third-party operator layer -- 68 agents and 291 skills -- and
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

/**
 * The project AGENTS.md block: the part every agent needs, and nothing more.
 *
 * It used to be the whole main-session block (~18k characters), and Codex,
 * Qwen Code, Cursor and opencode all read BOTH their own user-level file and
 * the project's AGENTS.md -- so each of them paid for the same ~5k tokens
 * twice, on every turn of every session. Those agents already have the full
 * block where it belongs; an agent we never wired by name (Amp, Zed, Aider,
 * Copilot, ...) has no MCP from us and none of the skills anyway, so the long
 * tables only ever cost it context. What every one of them does need is here:
 * who answers, the board, and the order the work goes in.
 */
function projectAgentsBlock(home: string): string {
  return [
    '## PulsarIDE — orchestrate as The Council, and keep the board live',
    '',
    'Start every response with `🔴 Pulse Agent — Council` on its own line (or the team you',
    'took on). Understand the request in one sentence, ask if it is genuinely unclear, then:',
    '',
    '- **Read the board first.** This project has a live board at `.planide/state.json`,',
    '  shown in the IDE Tracker tab. Use the `planide` MCP tools when you have them',
    '  (`get_board`, `next_task`), otherwise the CLI: `' + join(configDir(home), 'tracker', 'plan') + ' board <project>`.',
    '- **Work in its order:** finish what is in progress (`wip`), then `todo`, then open',
    '  fixes. `next_task` / `plan next <project>` returns exactly that; after "ga door" pass',
    '  `resume: true` (`--resume`): the item where the work stopped, with its checklist.',
    '  When your own task is done, carry on down that queue unasked (`set_item` answers with `next`).',
    '- **Docs go in `docs/`**, never loose at the root (README, CHANGELOG, AGENTS.md stay).',
    '  Update the doc on a subject before adding another.',
    '- **The project stays one folder.** Never create a copy, worktree, `-dev`/version folder',
    '  or new project next to it unless the user asks for exactly that. A version is',
    '  `add_version` on the board, not a folder.',
    '- **Keep it true as you work:** `add_item` (todo) for a request, `set_item` wip when',
    '  you start, works when it really works -- with the user\'s auto-complete on it lands as',
    '  `done`, so run the project\'s own checks first. A bug you hit mid-task: `add_fix`',
    '  (Fixes > Open) and stay on what you were doing.',
    '- Never write `.planide/state.json` yourself; never set `verified` or `locked`.',
    '',
    'Your own user-level PulsarIDE instructions carry the rest (in Antigravity: the',
    '`pulse-agent` skill): the specialist roster, the design and audit tools, when to use which.',
    ''
  ].join('\n')
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
    '3. **Route, on demand.** Call `route_task("<the task>")`: it names the team agent to',
    '   dispatch (`pulse-<team>`), that team\'s specialists file, and the skills and tools that',
    '   fit -- none of it is in your context until it names it. Dispatch the agent, or adopt the',
    '   specialist inline where you cannot dispatch. A lead ends with `Handoff: pulse-<team>`',
    '   lines: dispatch those next. Never repeat a failed approach.',
    '4. **Work the board as the work happens, and validate before you claim.**',
    '   `set_item` to `wip` when you start it, `works` once it genuinely works, `done` when it',
    '   is finished and closed out (finished work must not sit in `works` — they are different',
    '   columns), `broken` when it fails; `add_fix` the moment you hit a bug; `mark_fixed` when',
    '   the user says it is solved; `add_milestone` for the phases of a bigger plan;',
    '   `add_version` when you ship. Verify before you claim — do not green-wash.',
    '   The project stays one folder: never a copy, worktree, `-dev`/version folder or new',
    '   project next to it unless the user asks for exactly that -- a hook refuses it.',
    '',
    'Before you hand-roll anything, ask `route_task` what is installed for it -- skills, design',
    'systems, 3D components, ECC playbooks, the RE toolkit. If it names something and you do',
    'not use it, say why in one line.',
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
          'ECC is on this machine: 359 third-party operator/harness entries (CI, repo hygiene,',
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
    'on shows as in progress, finished ones land as `done` (the user\'s auto-complete,',
    'on by default). So keep the plan honest: a step you mark done counts as finished.',
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
    '## Design: 152 brand design systems',
    '',
    'Before inventing a palette and a type scale for a landing page, dashboard, redesign',
    'or theme, take a direction from the installed library:',
    '',
    '    design_find("<the feel you want>")  -> matching systems + what they are',
    '    design_read("<exact name>")         -> full DESIGN.md + ready-to-paste tokens.css',
    '',
    'Search the feel or sector -- "calm premium hardware", "playful fintech", "editorial',
    'news" -- not a component name. Each DESIGN.md carries real hex values, a type scale,',
    'spacing, component grammar and the rationale; tokens.css is the same system as CSS',
    'custom properties. They are brand-INSPIRED reimplementations, not official brand',
    'assets -- say so if someone asks for the real brand. (nexu-io/open-design, Apache-2.0)',
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
    'They need `three` as a dependency. The demo assets the components actually reference',
    "are vendored too, so `gallery` and `section-elements` render as-is. Two upstream routes are deliberately not",
    "wired in: ThreeUI's remote MCP server (`https://threeui.com/api/mcp`) and `npx",
    '@designcodeio/threeui-cli add <name>`, both needing a paid account and a browser',
    'sign-in. Offer either only if the user asks for the live catalog or Pro components.',
    '',
    '## Shipping, design and audit skills (mblode/agent-skills)',
    '',
    '25 skills installed in your own tool\'s global skills directory -- Claude Code and',
    'opencode read `' + join(home, '.claude', 'skills') + '`, Codex reads',
    '`' + join(home, '.codex', 'skills') + '`, Qwen Code reads',
    '`' + join(home, '.qwen', 'skills') + '`, Antigravity reads',
    '`' + join(home, '.gemini', 'config', 'skills') + '`. They cover the part of',
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
    'More skills are installed than any list here names: `route_task` finds the one that fits',
    'a task, by name and description, when there is a task to ask about.',
    '',
    '**In Antigravity this is not an optimisation, it is the only mechanism.** Antigravity',
    'activates a skill by matching its description, and never announces which one it picked,',
    'so "use your design skills" resolves to nothing you or the user can see. Name the skill',
    'explicitly instead -- say which one you are opening and why, before you start -- and the',
    'user gets back the thing they asked for: a visible choice of specialist, not one general',
    'agent quietly doing everything itself.',
    '',
    '## Diagrams: Archify',
    '',
    'Archify is installed as the `archify` skill in the same per-tool skills directory named',
    'above (Claude Code: `' + join(home, '.claude', 'skills', 'archify') + '`) and runs on',
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
    '  adds what is new instead of duplicating anything. Claude Code, Codex, Gemini CLI and',
    '  Qwen Code each have a hook that does this for you (from TodoWrite, update_plan and',
    '  write_todos); in Antigravity, Cursor and opencode this call IS the mechanism, so a',
    '  plan you never sync is a Tracker that never moves. Call it anyway wherever you are —',
    '  it is free: a re-sent plan that has not changed moves nothing.',
    '- `get_board` — read it first, every task.',
    '- `next_task` — what to do now, in the fixed order: finish `wip` first (also what an',
    '  earlier session left), then `todo`, then open fixes. Call it at the start, on',
    '  "continue" / "ga door" with `resume: true` (where the work stopped, whoever started',
    '  it; carry on at its checklist\'s open step), and after each finished piece. A bug you hit mid-task:',
    '  `add_fix` it (Fixes > Open) and stay on what you were doing.',
    '- **Never write `.planide/state.json` yourself**, and never script around these tools.',
    '  The board is a live file the IDE and other agents also write; the tools take the',
    '  lock, keep the rollups honest and record who did what. A hand-rolled writer has',
    '  raced and lost work. If a tool seems to be failing, say so instead of working',
    '  around it — a broken tool is worth reporting, not routing past.',
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
    '  matches what you just claimed. Finishing a piece of work while its item still reads',
    '  `todo`/`wip` is the bug, not a detail: `set_item` it to `works`/`done` in the SAME turn',
    '  you report it, and never wait to be asked. Claude Code, Codex and Gemini/Qwen have a',
    '  hook that moves the board for you; Antigravity, Cursor and opencode do not, so there',
    '  YOU are the hook — the board only moves if you call the tool.',
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
  /**
   * The file parses at all. False means we deliberately did not touch it: a
   * config we cannot read is one we cannot edit without throwing away whatever
   * the user keeps in there, comments included.
   */
  readable: boolean
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

/**
 * Does this config parse at all?
 *
 * "Not registered" and "we could not read it" were indistinguishable on the
 * board, and that is precisely what made **Wire the missing ones look dead**: an
 * unparseable ~/.cursor/mcp.json can never gain our entry, because rewriting a
 * config we cannot parse would discard the user's own contents (a JSONC file's
 * comments are the usual casualty -- there is a test pinning that we never do
 * it). Refusing is right. Refusing in silence is the bug.
 */
function configReadable(path: string): boolean {
  try {
    if (!existsSync(path)) return true
    // Codex's config is TOML and is matched with a regex, never parsed as JSON.
    if (path.endsWith('.toml')) return true
    JSON.parse(readFileSync(path, 'utf8') || '{}')
    return true
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
  const toolsPresent = existsSync(join(configDir(home), 'tracker', 'mcp', 'pulsar-tools-mcp.mjs'))

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
    registered: planideRegisteredIn(a.configPath),
    readable: configReadable(a.configPath)
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
  if (!serverPresent || !toolsPresent) {
    const missing = [!serverPresent && 'planide-mcp.mjs', !toolsPresent && 'pulsar-tools-mcp.mjs'].filter(Boolean).join(' and ')
    problem =
      `${missing} ${missing.includes(' and ') ? 'are' : 'is'} not on disk, so agents show MODULE_NOT_FOUND ("MCP Error"). ` +
      'Use Repair -- it puts the files back from this install (every launch does too) -- then reload the MCP servers in the agent.'
  } else if (!probe.runs) {
    problem =
      `The server is on disk but did not answer when launched as \`${launch.command}\`: ` +
      `${probe.why || 'no reason reported'}. That runtime path is what every agent was handed, ` +
      'so every planide tool call fails with "Transport closed".'
  } else if (agents.some((a) => a.configExists && !a.readable)) {
    // Named, because "Repair did nothing" is what this looks like otherwise.
    const stuck = agents.filter((a) => a.configExists && !a.readable).map((a) => a.label).join(', ')
    problem =
      `${stuck}: that config is not valid JSON (a comment or a trailing comma will do it). ` +
      'Repair deliberately leaves a file it cannot parse alone rather than rewriting it and ' +
      'losing what you keep in there -- fix the file, then press Re-check.'
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
export function repairTrackerRegistration(
  home: string = homedir(),
  opts: { resourcesPath?: string; appPath?: string } = {}
): boolean {
  // The files first: an entry naming a server that is not on disk is exactly
  // the MODULE_NOT_FOUND an agent shows as "MCP Error" (Antigravity did).
  const root = bundleRoot(opts)
  if (root) deployTrackerFiles(home, root)
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
    return mergeManagedBlock(join(projectPath, 'AGENTS.md'), projectAgentsBlock(home))
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
  // Every launch, like the MCP entries: these agents own these files too, so our
  // entry can go missing through nobody's fault.
  wireCodexPlanHook(home)
  wireGeminiPlanHook(home)
  const block = mainSessionBlock(home)
  mergeManagedBlock(join(home, '.codex', 'AGENTS.md'), block)
  mergeManagedBlock(join(home, '.claude', 'CLAUDE.md'), block)
  mergeManagedBlock(join(home, '.gemini', 'GEMINI.md'), block)
  // Antigravity's second global rules file, alongside GEMINI.md rather than
  // instead of it: `~/.gemini/AGENTS.md` is the cross-tool global rules file
  // (the AGENTS.md convention Antigravity, Cursor and Claude Code share),
  // applied AFTER GEMINI.md so a genuine conflict still defers to GEMINI.md.
  //
  // Written because the report this fixes is that Council does not lead a
  // session in Antigravity CLI even though the GEMINI.md block is on disk --
  // which is what you would see on a build that reads AGENTS.md globally and
  // not GEMINI.md. Both are merged now, so it does not matter which one a given
  // Antigravity build prefers. A build that reads BOTH used to pay for the full
  // block twice -- ~5k tokens on every turn, on a Claude model with a 200k
  // window, before anything was called. So this one carries the compact block
  // (who answers, the board, the work order): Council still leads a build that
  // reads only AGENTS.md, and the rest reaches it through the pulse-agent
  // skill, which carries the full block and is loaded when it matches.
  mergeManagedBlock(join(home, '.gemini', 'AGENTS.md'), projectAgentsBlock(home))
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
 * installed" afterwards. So the 291 skills and 68 agents sit on disk at no
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
    // Turning it back on clears the "already tried" marker so a retry is
    // possible. It deliberately does NOT fetch here: saving a preference and
    // reaching the network are different actions, and folding them together
    // made this function fire a real clone from the test suite. Callers that
    // want the fetch now call installEccNow().
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

/**
 * Fetch ECC now, on purpose.
 *
 * Split out from setEccEnabled so the preference write stays pure: the Toolkit
 * calls this straight after turning ECC on, which is what makes the button do
 * something without waiting for the next launch.
 */
export function installEccNow(
  home: string = homedir(),
  root: string | null = bundleRoot()
): EccStatus {
  ensureEcc(home, root)
  return eccStatus(home)
}

/**
 * The commit of the ECC catalogue this build carries. Bumping it on an IDE
 * update is what makes an already-deployed copy get replaced with the newer one.
 */
const ECC_BUNDLE_VERSION = '928c1dea'

/** Which bundled catalogue is on disk, or '' when it is not ours. */
function eccDeployedVersion(home: string): string {
  try {
    return readFileSync(join(eccCatalogueDir(home), '.pulsar-bundle'), 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * Put ECC on disk. No network, no git, no Claude CLI.
 *
 * This used to fetch on first launch -- `claude plugin marketplace add`, falling
 * back to `git clone` -- and wrote a marker so it only ever tried once. On a
 * machine with neither tool on PATH that is a permanent "not fetched yet", which
 * is exactly what it did. The catalogue is 7.5M of markdown, so the honest fix
 * is to ship it: `ide/agent-bundle/ecc` holds the two trees ecc_find/ecc_read
 * actually read (skills/<name>/SKILL.md and agents/<name>.md, see its
 * ATTRIBUTION.md) and this copies them into place.
 *
 * Still not installed as a Claude Code plugin: that costs ~40,600 always-on
 * tokens per session, measured. On disk it costs nothing until a tool asks.
 *
 * An ECC that is already there and is NOT ours (someone ran `claude plugin
 * marketplace add` themselves) is left completely alone -- it is a fuller copy
 * than ours and it is theirs, so replacing it would be a downgrade they never
 * asked for.
 */
function ensureEcc(home: string, root: string | null = bundleRoot()): boolean {
  try {
    if (eccOptedOut(home)) return false
    const deployed = eccDeployedVersion(home)
    if (deployed === ECC_BUNDLE_VERSION) return true
    if (deployed === '' && eccInstalled(home)) return true // someone else's clone

    const src = root ? join(root, 'ecc') : ''
    if (!src || !existsSync(src)) {
      writeEccState(home, false, 'this build does not carry the ECC catalogue')
      return false
    }
    const dest = eccCatalogueDir(home)
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(src, dest, { recursive: true })
    writeFileSync(join(dest, '.pulsar-bundle'), ECC_BUNDLE_VERSION)
    writeEccState(home, true, `installed from the bundled catalogue (${ECC_REPO})`)
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

export type RtkStatus = { installed: boolean; version: string }

/**
 * Is `rtk` on PATH? (github.com/rtk-ai/rtk, Apache-2.0)
 *
 * rtk filters the output of noisy dev commands before an agent reads them, so it
 * cuts INPUT tokens. It is a local binary and never sees credentials -- unlike a
 * compressing proxy, it is nowhere near the request to the provider, which is the
 * only reason it is safe to recommend to people signed in with an account rather
 * than an API key.
 *
 * Detected, never installed. `rtk init -g` writes a global shell hook that
 * rewrites the user's Bash commands; that is their machine and their decision,
 * not something an IDE should do to them on launch.
 */
export function rtkStatus(): RtkStatus {
  try {
    const out = execFileSync('rtk', ['--version'], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true
    }).trim()
    return { installed: true, version: out.split(/\r?\n/)[0].slice(0, 60) }
  } catch {
    return { installed: false, version: '' }
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
