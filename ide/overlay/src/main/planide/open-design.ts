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
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
  // Enumerate EVERY `od` on PATH, not just the first. OpenDesign's own README
  // says the desktop app "installs the od command on the system PATH", and in
  // the same breath warns that coreutils' /usr/bin/od "can shadow OpenDesign's
  // od command" -- so on a real install the OpenDesign one is frequently the
  // SECOND entry, sitting behind coreutils in PATH order. Taking only the first
  // match (the old behaviour) found coreutils, rejected it, and then reported
  // "not detected" even though OpenDesign was installed and one entry further
  // down. `which -a` / `where` list them all; we take the first that is not
  // coreutils.
  try {
    const [which, args]: [string, string[]] =
      process.platform === 'win32' ? ['where', ['od']] : ['which', ['-a', 'od']]
    const out = execFileSync(which, args, {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true
    }).toString()
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim()
      if (p && !isCoreutilsOd(p)) return p
    }
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

// --------------------------------------------------------------------------- install

/**
 * Fetch and start OpenDesign's own installer, so nobody has to go find it.
 *
 * Asked for twice: "die moet ik nog steeds installeren ... ik zei dat je die
 * pre-installed moest doen." The honest constraint is that OpenDesign is a
 * separate desktop application, not a library: it publishes no npm package (the
 * `opendesign` name on npm is an unrelated .octopus CLI), and its repo is a
 * ~600 MB pnpm monorepo requiring Node ~24 to build. Embedding another vendor's
 * desktop app inside our installer is not something to do quietly either -- it
 * would multiply our download and redistribute their signed binaries.
 *
 * What it DOES publish is prebuilt releases, per platform, which its own README
 * calls "the fastest way to use OpenDesign. No Node, no pnpm, no clone." So the
 * install is a real thing we can do FOR the user: pick the asset that matches
 * this machine, download it, and hand it to the OS. That removes every step
 * except the vendor's own installer window.
 *
 * Nothing is silently executed: the downloaded file is opened the way a
 * double-click would open it, so the user still sees and approves the install.
 */
const OD_RELEASES_API = 'https://api.github.com/repos/nexu-io/open-design/releases/latest'
/** A download that hangs must not leave the panel spinning for ever. */
const OD_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000

export type OpenDesignInstall = {
  ok: boolean
  /** Where the downloaded installer landed, when it got that far. */
  file?: string
  /** The release we picked, for the panel to name. */
  version?: string
  /** True once the OS has been asked to open it. */
  launched: boolean
  message: string
}

/** The asset that fits this platform, or null when the release has none. */
export function pickOpenDesignAsset(
  assets: { name: string; browser_download_url: string }[],
  platform: string = process.platform,
  arch: string = process.arch
): { name: string; browser_download_url: string } | null {
  const lower = (a: { name: string }): string => a.name.toLowerCase()
  if (platform === 'win32') {
    return assets.find((a) => lower(a).endsWith('.exe')) ?? null
  }
  if (platform === 'darwin') {
    const dmgs = assets.filter((a) => lower(a).endsWith('.dmg'))
    // Apple Silicon and Intel builds ship side by side; picking the wrong one
    // installs an app that will not start, so match the architecture first and
    // only fall back to "any .dmg" when a release does not split them.
    const wanted = arch === 'arm64' ? ['arm64', 'aarch64', 'apple'] : ['x64', 'x86_64', 'intel']
    return dmgs.find((a) => wanted.some((w) => lower(a).includes(w))) ?? dmgs[0] ?? null
  }
  return assets.find((a) => lower(a).endsWith('.appimage')) ?? null
}

export async function openDesignInstall(home: string = homedir()): Promise<OpenDesignInstall> {
  if (openDesignStatus(home).installed) {
    return { ok: true, launched: false, message: 'OpenDesign is already installed.' }
  }
  let release: { tag_name?: string; assets?: { name: string; browser_download_url: string }[] }
  try {
    const res = await fetch(OD_RELEASES_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'PulsarIDE' },
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    release = (await res.json()) as typeof release
  } catch (err) {
    return {
      ok: false,
      launched: false,
      message: `Could not reach OpenDesign's releases: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const asset = pickOpenDesignAsset(release.assets ?? [])
  if (!asset) {
    return {
      ok: false,
      launched: false,
      message: `That release has no download for ${process.platform}. Open open-design.ai to pick one by hand.`
    }
  }

  const dir = join(home, '.config', 'pulsaride', 'downloads')
  const file = join(dir, asset.name)
  try {
    mkdirSync(dir, { recursive: true })
    const res = await fetch(asset.browser_download_url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(OD_DOWNLOAD_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`download answered ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    // An AppImage is only useful once it is allowed to run.
    if (process.platform === 'linux') {
      try {
        chmodSync(file, 0o755)
      } catch {
        /* a filesystem without exec bits -- the user can still run it */
      }
    }
  } catch (err) {
    return {
      ok: false,
      launched: false,
      message: `Downloading ${asset.name} failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  // Handed to the OS the way a double-click would be -- deliberately not run
  // silently: this is the vendor's installer and the user should see it ask for
  // what it wants. Done with the platform opener rather than electron's `shell`
  // so this module stays free of electron and keeps its own typecheck.
  let launched = false
  try {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', file]]
        : process.platform === 'darwin'
          ? ['open', [file]]
          : ['xdg-open', [file]]
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 10_000, windowsHide: true })
    launched = true
  } catch {
    /* no opener here -- the file is downloaded either way, and we say so */
  }
  return {
    ok: true,
    file,
    version: release.tag_name,
    launched,
    message: launched
      ? `Downloaded ${asset.name} and opened it. Finish OpenDesign's own installer, then come back and connect it.`
      : `Downloaded ${asset.name} to ${file}. Open it to finish installing OpenDesign.`
  }
}
