/**
 * OpenDesign (nexu-io/open-design) -- the design engine, wired to every agent.
 *
 * OpenDesign is an Apache-2.0 local-first design tool whose whole premise is
 * that a coding agent IS the design engine: it turns a brief into prototypes,
 * dashboards, decks, documents and motion graphics, and exports real HTML, PDF,
 * PPTX and MP4. It reaches agents through an MCP server, which is exactly why
 * it fits here -- one integration and Claude Code, Codex, Cursor and the rest
 * can all drive it.
 *
 * Two rules this module holds to:
 *
 *  1. We never install OpenDesign. `od` is third-party software the user
 *     chooses to install (desktop app, or their install.sh). We detect it and
 *     say so honestly when it is missing, the same way graphify is handled.
 *  2. We never invent its config. OpenDesign's README documents
 *     `od mcp install <agent>` as the way to wire an agent, and documents no
 *     raw mcpServers JSON -- so we run THEIR command and report THEIR output,
 *     rather than guessing at a server invocation and writing it into an
 *     agent's config ourselves.
 */

import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type OpenDesignProject = { id: string; name: string; path: string; updatedAt: string }

export type OpenDesignStatus = {
  /** `od` resolved on PATH (or in a known install location). */
  installed: boolean
  /** Absolute path we resolved, for the UI to show. */
  binary: string | null
  version: string | null
  projects: OpenDesignProject[]
  /** Set when `od` is present but a call failed -- shown rather than swallowed. */
  error: string | null
}

/** Where the desktop app puts the CLI, when it is not already on PATH. */
function candidateBinaries(home: string): string[] {
  const names = process.platform === 'win32' ? ['od.cmd', 'od.exe'] : ['od']
  const dirs =
    process.platform === 'win32'
      ? [join(home, 'AppData', 'Local', 'Programs', 'OpenDesign'), join(home, '.open-design', 'bin')]
      : [
          join(home, '.local', 'bin'),
          '/usr/local/bin',
          '/opt/homebrew/bin',
          join(home, '.open-design', 'bin')
        ]
  return dirs.flatMap((d) => names.map((n) => join(d, n)))
}

/**
 * `od` is also GNU coreutils' octal-dump utility, which is on essentially every
 * Linux and macOS machine -- so finding a binary named `od` on PATH says
 * nothing about OpenDesign being installed.
 *
 * Seen for real in a running build: the panel reported OpenDesign INSTALLED at
 * /usr/bin/od, then showed `od: unrecognized option '--json'` where the project
 * list should be.
 *
 * This rejects what can actually be observed -- coreutils names itself in
 * `--version` -- rather than asserting a positive OpenDesign signature that has
 * not been confirmed against the real tool. Anything inconclusive (no
 * `--version`, a non-zero exit) is kept: a false reject would hide a genuine
 * install, which is the worse failure of the two.
 */
function isCoreutilsOd(binary: string): boolean {
  try {
    const out = execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true
    }).toString()
    return /GNU coreutils/i.test(out)
  } catch {
    return false
  }
}

function resolveBinary(home: string): string | null {
  // PATH first: if the user has it there, that is the one they mean -- unless
  // what PATH found is coreutils wearing the same name.
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(which, ['od'], { encoding: 'utf8', timeout: 4000, windowsHide: true })
      .toString()
      .trim()
    const first = out.split(/\r?\n/)[0]?.trim()
    if (first && !isCoreutilsOd(first)) return first
  } catch {
    /* not on PATH; fall through to the known install locations */
  }
  // A real OpenDesign install in one of its own directories still counts, even
  // when coreutils won PATH.
  for (const p of candidateBinaries(home)) if (existsSync(p) && !isCoreutilsOd(p)) return p
  return null
}

function run(binary: string, args: string[], timeout = 8000): string {
  return execFileSync(binary, args, { encoding: 'utf8', timeout, windowsHide: true }).toString()
}

/**
 * Parse `od project list --json`. Deliberately forgiving about the envelope: a
 * bare array and a `{ projects: [...] }` wrapper are both accepted, and an
 * entry missing a field keeps a blank rather than being dropped, so a schema we
 * have not pinned down cannot silently empty the list.
 */
function parseProjects(json: string): OpenDesignProject[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  const wrapped = (data as { projects?: unknown })?.projects
  const rows: unknown[] = Array.isArray(data) ? data : Array.isArray(wrapped) ? wrapped : []
  const out: OpenDesignProject[] = []
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '')
    const name = str('name') || str('title') || str('id')
    if (!name) continue
    out.push({
      id: str('id') || name,
      name,
      path: str('path') || str('dir'),
      updatedAt: str('updatedAt') || str('updated_at')
    })
  }
  return out
}

export function openDesignStatus(home: string = homedir()): OpenDesignStatus {
  const binary = resolveBinary(home)
  if (!binary) return { installed: false, binary: null, version: null, projects: [], error: null }

  let version: string | null = null
  let projects: OpenDesignProject[] = []
  let error: string | null = null
  try {
    version = run(binary, ['--version']).trim().split(/\r?\n/)[0] ?? null
  } catch {
    /* a CLI that cannot report a version is still usable */
  }
  try {
    projects = parseProjects(run(binary, ['project', 'list', '--json']))
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  return { installed: true, binary, version, projects, error }
}

export type ConnectResult = { agent: string; ok: boolean; output: string }

/**
 * Run OpenDesign's own `od mcp install <agent>` for each agent asked for.
 *
 * Explicitly user-triggered, never on startup: this rewrites another tool's
 * agent config, which is not something to do behind someone's back. Each agent
 * is reported separately with od's real output, so an agent OpenDesign does not
 * support fails visibly instead of being silently skipped -- we keep no list of
 * our own about which agents it supports, because od is the only thing that
 * actually knows.
 */
export function connectOpenDesignToAgents(
  agents: string[],
  home: string = homedir()
): ConnectResult[] {
  const binary = resolveBinary(home)
  if (!binary) {
    return agents.map((a) => ({ agent: a, ok: false, output: 'OpenDesign (od) is not installed' }))
  }
  return agents.map((agent) => {
    try {
      return { agent, ok: true, output: run(binary, ['mcp', 'install', agent], 30000).trim() }
    } catch (err) {
      const e = err as { stderr?: unknown; stdout?: unknown; message?: string }
      const text = String(e.stderr ?? e.stdout ?? e.message ?? 'failed').trim()
      return { agent, ok: false, output: text }
    }
  })
}

/** Open the OpenDesign app, best-effort and non-blocking. */
export function openDesignLaunch(home: string = homedir()): boolean {
  const binary = resolveBinary(home)
  if (!binary) return false
  try {
    execFile(binary, ['open'], { timeout: 5000, windowsHide: true }, () => {})
    return true
  } catch {
    return false
  }
}
