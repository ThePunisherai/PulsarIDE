/**
 * Headroom, removed from the machine -- not only from our bundle.
 *
 * PulsarIDE stopped shipping every reference to Headroom in 0.29.0, but it was
 * never ours to install: the separate ThePunisher-Agent installer put it there,
 * wiring a shell hook into the user's shell profiles ("headroom/shell-hook.sh,
 * already wired into .bashrc/.zshrc by auto-headroom.sh") and pointing agents at
 * its local proxy. So it kept running. Every terminal PulsarIDE opens -- one per
 * agent pane -- loads the user's profile, and with it the hook, which is the
 * console window that kept popping up: "haal die klote headroom eruit,
 * irriteert mij mateloos met ze cmd schermpje". Its proxy also forced a fresh
 * OAuth login on Codex ChatGPT-auth users (see skills/caveman/ATTRIBUTION.md).
 *
 * What this removes, wherever it names Headroom:
 *  - lines in shell profiles (PowerShell, bash, zsh, fish) -- a self-contained
 *    line or a marked block only. A Headroom line in the middle of someone's
 *    if/else is left alone and reported: deleting half a block would break the
 *    profile, which is worse than the window it opens.
 *  - hooks, env redirects and MCP entries in the Claude Code, Gemini CLI and
 *    Codex configs (a localhost:8787 base URL is Headroom's proxy port).
 *  - Windows only: Startup-folder entries, Run-key values, scheduled tasks and
 *    user environment variables, and a running headroom.exe.
 *
 * Every file it changes is copied into a backup folder first; the report says
 * what went and where the backups are. Every process it starts is hidden
 * (windowsHide): a cleanup for a console window must not open one.
 */
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

export type HeadroomTrace = {
  where: string
  /**
   * removed: gone (backed up). manual: found, but changing it safely needs a
   * person. restored: something an earlier version took away, put back.
   */
  action: 'removed' | 'manual' | 'restored'
  detail: string
  /** A registry value's full previous content, so it can always be put back. */
  previous?: string
}

export type HeadroomCleanupReport = {
  at: string
  backupDir: string
  traces: HeadroomTrace[]
}

/** Runs a hidden child process and resolves with its stdout; rejects on failure. */
export type HiddenExec = (file: string, args: string[]) => Promise<string>

export type HeadroomCleanupOptions = {
  home: string
  /** Where backups go. Created only if something is actually changed. */
  backupDir: string
  platform?: NodeJS.Platform
  /** The Windows half (registry, tasks, processes) spawns tools; off unless asked. */
  includeSystem?: boolean
  exec?: HiddenExec
  appData?: string
}

const MARK = /headroom/i
/** Headroom's proxy as an agent base URL: its own name, or its default port on loopback. */
const PROXY_URL = /headroom|\/\/(localhost|127\.0\.0\.1|\[::1\]):8787\b/i
const BASE_URL_KEYS = new Set(['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'CODEX_BASE_URL'])

// Asynchronous on purpose: `schtasks /Query /V` can take seconds, and this runs
// in the main process, where a synchronous call would freeze every window.
const hiddenExec: HiddenExec = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, encoding: 'utf8', timeout: 15000 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout))
    )
  })

// --------------------------------------------------------------------------- text

/** A line that is a whole statement by itself: brackets balance, nothing continues it. */
function selfContained(line: string): boolean {
  let depth = 0
  for (const ch of line) {
    if (ch === '(' || ch === '{' || ch === '[') depth += 1
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1
    if (depth < 0) return false
  }
  const t = line.trim()
  if (depth !== 0) return false
  // A trailing continuation, pipe or block opener means the next line belongs to it.
  return !/(`|\\|&&|\|\||\||\bthen|\bdo|\belse)$/.test(t)
}

const isComment = (line: string): boolean => /^\s*#/.test(line)

/** How a profile nests statements: decides when a line sits inside a block. */
export type Dialect = 'posix' | 'fish' | 'powershell'

export function profileDialect(file: string): Dialect {
  if (/\.ps1$/i.test(file)) return 'powershell'
  if (/\.fish$/i.test(file)) return 'fish'
  return 'posix'
}

/**
 * How far a line opens (+) or closes (-) a block. Approximate on purpose, and
 * wrong only in the safe direction: a miscount leaves the depth off zero, and
 * off zero nothing is removed. bash/zsh count braces and if/for/while/case
 * against fi/done/esac -- not parentheses, which a `case` pattern leaves
 * unbalanced; fish counts its keywords against `end`; PowerShell counts brackets.
 */
function depthDelta(line: string, dialect: Dialect): number {
  const code = line.replace(/(^|\s)#.*$/, '$1').trim()
  if (!code) return 0
  const count = (re: RegExp): number => (code.match(re) ?? []).length
  if (dialect === 'powershell') return count(/[{([]/g) - count(/[})\]]/g)
  if (dialect === 'fish') {
    return (
      count(/(^|;)\s*(if|for|while|function|switch|begin)\b/g) -
      count(/(^|;)\s*end\b/g) +
      count(/\(/g) -
      count(/\)/g)
    )
  }
  return (
    count(/\{/g) -
    count(/\}/g) +
    count(/(^|;|&&|\|\||\bthen|\bdo|\belse)\s*(if|for|while|until|case|select)\b/g) -
    count(/(^|;)\s*(fi|done|esac)\b/g)
  )
}
const opensBlock = (line: string): boolean => MARK.test(line) && /(>>>|\bbegin\b|\bstart\b)/i.test(line) && isComment(line)
const closesBlock = (line: string): boolean => MARK.test(line) && /(<<<|\bend\b)/i.test(line) && isComment(line)

/** The variable a line sets, if it is an assignment -- so its later uses can be checked. */
function assignedName(line: string, dialect: Dialect): string | null {
  const m =
    dialect === 'powershell'
      ? /^\s*\$(?:env:|global:|script:)?(\w+)\s*=/i.exec(line)
      : dialect === 'fish'
        ? /^\s*set\s+(?:-\w+\s+)*(\w+)/.exec(line)
        : /^\s*(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)=/.exec(line)
  return m ? m[1] : null
}

/**
 * Removes Headroom from a profile's text. Marked blocks go whole; otherwise
 * only comments and self-contained top-level lines. A Headroom line that is
 * part of a larger statement, or inside an if/function/loop body, changes
 * nothing and `blocked` says so: removing the only statement of a bash `then`
 * leaves a syntax error in every shell the profile starts.
 */
export function stripHeadroomLines(
  text: string,
  dialect: Dialect = 'posix'
): { text: string; removed: number; blocked: boolean } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const keep: string[] = []
  const blocked = { text, removed: 0, blocked: true }
  const gone: string[] = []
  let inBlock = false
  let depth = 0
  for (const line of lines) {
    if (inBlock) {
      gone.push(line)
      if (closesBlock(line)) inBlock = false
      continue
    }
    if (opensBlock(line)) {
      if (depth !== 0) return blocked
      inBlock = true
      gone.push(line)
      continue
    }
    if (!MARK.test(line)) {
      keep.push(line)
      depth += depthDelta(line, dialect)
      continue
    }
    // A comment is never a statement, so dropping one cannot empty a block.
    if (isComment(line)) {
      gone.push(line)
      continue
    }
    if (depth === 0 && selfContained(line) && depthDelta(line, dialect) === 0) {
      gone.push(line)
      continue
    }
    return blocked
  }
  // An opening marker with no close: do not guess where it ends.
  if (inBlock) return blocked
  // A removed line that set a variable the rest still reads would turn into an
  // error in every new shell -- `Test-Path $null` -- so then nothing goes.
  const names = new Set<string>()
  for (const line of gone) {
    const name = assignedName(line, dialect)
    if (name) names.add(name)
  }
  for (const name of names) {
    const use = new RegExp(`\\$(?:env:|global:|script:)?\\{?${name}\\b`, dialect === 'powershell' ? 'i' : '')
    if (keep.some((line) => use.test(line) && assignedName(line, dialect) !== name)) return blocked
  }
  return { text: keep.join(eol), removed: gone.length, blocked: false }
}

/** Drops a TOML table whose header names Headroom, and Headroom key = value lines. */
export function stripHeadroomToml(text: string): { text: string; removed: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const keep: string[] = []
  let removed = 0
  let inTable = false
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(line)
    if (header) {
      inTable = MARK.test(header[1])
      if (inTable) {
        removed += 1
        continue
      }
    } else if (inTable) {
      removed += 1
      continue
    } else if (MARK.test(line) || (/^\s*\w*base_url\s*=/i.test(line) && PROXY_URL.test(line))) {
      removed += 1
      continue
    }
    keep.push(line)
  }
  return { text: keep.join(eol), removed }
}

/** Hooks, env redirects and MCP servers that name Headroom, out of a Claude/Gemini-style config. */
export function stripHeadroomJson(
  config: Record<string, unknown>,
  opts: { neutralizeHooks?: boolean } = {}
): string[] {
  const gone: string[] = []
  const hooks = config.hooks
  if (hooks && typeof hooks === 'object') {
    for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
      if (!Array.isArray(groups)) continue
      const kept: unknown[] = []
      for (const group of groups) {
        const inner = (group as { hooks?: unknown[] })?.hooks
        if (!Array.isArray(inner)) {
          kept.push(group)
          continue
        }
        const innerKept = inner.filter((h) => {
          const cmd = String((h as { command?: unknown })?.command ?? '')
          if (MARK.test(cmd)) {
            gone.push(`hook ${event}: ${cmd.slice(0, 120)}`)
            // Codex trusts hooks by position: keep the place, run nothing.
            if (opts.neutralizeHooks) {
              ;(h as { command: string }).command = 'exit 0'
              return true
            }
            return false
          }
          return true
        })
        if (innerKept.length) kept.push({ ...(group as object), hooks: innerKept })
      }
      ;(hooks as Record<string, unknown>)[event] = kept
    }
  }
  const env = config.env
  if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      const value = String(v ?? '')
      if (MARK.test(value) || (BASE_URL_KEYS.has(k) && PROXY_URL.test(value))) {
        delete (env as Record<string, unknown>)[k]
        gone.push(`env ${k}=${value.slice(0, 80)}`)
      }
    }
  }
  for (const key of ['mcpServers', 'mcp']) {
    const servers = config[key]
    if (!servers || typeof servers !== 'object') continue
    for (const [name, def] of Object.entries(servers as Record<string, unknown>)) {
      if (MARK.test(name) || MARK.test(JSON.stringify(def ?? ''))) {
        delete (servers as Record<string, unknown>)[name]
        gone.push(`${key}.${name}`)
      }
    }
  }
  return gone
}

// --------------------------------------------------------------------------- files

function backup(file: string, opts: HeadroomCleanupOptions): void {
  // Laid out as under the home folder, so a restore is one copy back.
  const rel = relative(opts.home, file)
  const inHome = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  const target = join(opts.backupDir, inHome ? rel : file.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, ''))
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(file, target)
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.pulsar-${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

function profileCandidates(opts: HeadroomCleanupOptions): string[] {
  const home = opts.home
  const out = [
    '.bashrc', '.bash_profile', '.profile', '.zshrc', '.zprofile', '.zshenv',
    join('.config', 'fish', 'config.fish')
  ].map((f) => join(home, f))
  // PowerShell's profiles live under Documents -- which OneDrive often moves.
  const documents = [join(home, 'Documents')]
  try {
    for (const d of readdirSync(home)) if (/^OneDrive/i.test(d)) documents.push(join(home, d, 'Documents'))
  } catch {
    /* unreadable home: the fixed list above still applies */
  }
  for (const doc of documents) {
    for (const shell of ['PowerShell', 'WindowsPowerShell']) {
      const dir = join(doc, shell)
      try {
        for (const f of readdirSync(dir)) if (/profile\.ps1$/i.test(f)) out.push(join(dir, f))
      } catch {
        /* no such shell folder */
      }
    }
  }
  return out
}

function cleanProfiles(opts: HeadroomCleanupOptions, traces: HeadroomTrace[]): void {
  for (const file of profileCandidates(opts)) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!MARK.test(text)) continue
    const result = stripHeadroomLines(text, profileDialect(file))
    if (result.blocked) {
      traces.push({ where: file, action: 'manual', detail: 'Headroom is inside a larger block here; edit it by hand' })
      continue
    }
    backup(file, opts)
    writeAtomic(file, result.text)
    traces.push({ where: file, action: 'removed', detail: `${result.removed} line(s)` })
  }
}

function cleanJsonConfigs(opts: HeadroomCleanupOptions, traces: HeadroomTrace[]): void {
  const files = [
    join(opts.home, '.claude', 'settings.json'),
    join(opts.home, '.claude', 'settings.local.json'),
    join(opts.home, '.claude.json'),
    join(opts.home, '.gemini', 'settings.json'),
    join(opts.home, '.qwen', 'settings.json'),
    // Codex keeps its hooks in their own file, in the same { hooks: { Event: [...] } } shape.
    join(opts.home, '.codex', 'hooks.json')
  ]
  for (const file of files) {
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!MARK.test(raw) && !PROXY_URL.test(raw)) continue
    let config: Record<string, unknown>
    try {
      config = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // Not ours to rewrite when we cannot read it -- say so instead.
      traces.push({ where: file, action: 'manual', detail: 'unparseable JSON that mentions Headroom' })
      continue
    }
    const gone = stripHeadroomJson(config, { neutralizeHooks: file.endsWith(join('.codex', 'hooks.json')) })
    if (!gone.length) continue
    backup(file, opts)
    writeAtomic(file, `${JSON.stringify(config, null, 2)}\n`)
    traces.push({ where: file, action: 'removed', detail: gone.join('; ') })
  }
}

function cleanCodexToml(opts: HeadroomCleanupOptions, traces: HeadroomTrace[]): void {
  const file = join(opts.home, '.codex', 'config.toml')
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return
  }
  if (!MARK.test(raw) && !PROXY_URL.test(raw)) return
  const result = stripHeadroomToml(raw)
  if (!result.removed) return
  backup(file, opts)
  writeAtomic(file, result.text)
  traces.push({ where: file, action: 'removed', detail: `${result.removed} line(s)` })
}

// --------------------------------------------------------------------------- windows

function cleanStartupFolder(opts: HeadroomCleanupOptions, traces: HeadroomTrace[]): void {
  const appData = opts.appData ?? process.env.APPDATA ?? join(opts.home, 'AppData', 'Roaming')
  const dir = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const file = join(dir, name)
    let hit = MARK.test(name)
    if (!hit && /\.(cmd|bat|ps1|vbs|js)$/i.test(name)) {
      try {
        hit = statSync(file).size < 64 * 1024 && MARK.test(readFileSync(file, 'utf8'))
      } catch {
        hit = false
      }
    }
    if (!hit) continue
    const target = join(opts.backupDir, 'Startup', name)
    mkdirSync(dirname(target), { recursive: true })
    renameSync(file, target)
    traces.push({ where: file, action: 'removed', detail: 'startup entry (moved to backup)' })
  }
}

/** `reg query` output: "    NAME    REG_SZ    VALUE" lines. */
export function parseRegValues(out: string): { name: string; type: string; value: string }[] {
  const rows: { name: string; type: string; value: string }[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{2,}(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/.exec(line)
    if (m) rows.push({ name: m[1], type: m[2], value: m[3] })
    else {
      // An empty value prints with nothing after the type.
      const e = /^\s{2,}(.+?)\s{2,}(REG_\w+)\s*$/.exec(line)
      if (e) rows.push({ name: e[1], type: e[2], value: '' })
    }
  }
  return rows
}

/**
 * The user's environment variables. Only a variable that IS Headroom's goes:
 * one named after it (HEADROOM_*), or an agent base URL pointing at its proxy.
 * A variable that merely mentions it -- above all `Path`, a list -- keeps
 * everything except Headroom's own entries.
 *
 * 0.98.0 deleted any variable whose value mentioned Headroom, so a user Path
 * holding one Headroom folder lost every other folder with it. That rule is
 * gone; repairUserPath (agent-bundle.ts) puts back what it removed.
 */
async function cleanEnvironment(exec: HiddenExec, traces: HeadroomTrace[]): Promise<void> {
  const key = 'HKCU\\Environment'
  let out = ''
  try {
    out = await exec('reg', ['query', key])
  } catch {
    return
  }
  for (const row of parseRegValues(out)) {
    const where = `${key}\\${row.name}`
    const ownVariable =
      MARK.test(row.name) || (BASE_URL_KEYS.has(row.name.toUpperCase()) && PROXY_URL.test(row.value))
    if (ownVariable) {
      try {
        await exec('reg', ['delete', key, '/v', row.name, '/f'])
        traces.push({ where, action: 'removed', detail: `user environment variable: ${row.value.slice(0, 120)}`, previous: row.value })
      } catch {
        traces.push({ where, action: 'manual', detail: 'user environment variable: could not delete' })
      }
      continue
    }
    if (!MARK.test(row.value)) continue
    const parts = row.value.split(';')
    const kept = parts.filter((p) => !MARK.test(p))
    // Not a list, or nothing but Headroom in it: changing it is a person's call.
    if (kept.length === parts.length || kept.filter((p) => p.trim()).length === 0) {
      traces.push({ where, action: 'manual', detail: `mentions Headroom; left as it is: ${row.value.slice(0, 120)}` })
      continue
    }
    try {
      await exec('reg', ['add', key, '/v', row.name, '/t', row.type, '/d', kept.join(';'), '/f'])
      traces.push({
        where,
        action: 'removed',
        detail: `${parts.length - kept.length} Headroom entr${parts.length - kept.length === 1 ? 'y' : 'ies'} taken out of ${row.name}, the rest kept`,
        previous: row.value
      })
    } catch {
      traces.push({ where, action: 'manual', detail: `could not rewrite ${row.name}` })
    }
  }
}

async function cleanRegistryValues(
  key: string,
  match: (row: { name: string; value: string }) => boolean,
  label: string,
  exec: HiddenExec,
  traces: HeadroomTrace[]
): Promise<void> {
  let out = ''
  try {
    out = await exec('reg', ['query', key])
  } catch {
    return
  }
  for (const row of parseRegValues(out)) {
    if (!match(row)) continue
    try {
      await exec('reg', ['delete', key, '/v', row.name, '/f'])
      traces.push({ where: `${key}\\${row.name}`, action: 'removed', detail: `${label}: ${row.value.slice(0, 120)}`, previous: row.value })
    } catch {
      traces.push({ where: `${key}\\${row.name}`, action: 'manual', detail: `${label}: could not delete` })
    }
  }
}

/** `schtasks /Query /V /FO CSV /NH`: the task name is the second column. */
export function headroomTaskNames(csv: string): string[] {
  const names = new Set<string>()
  for (const line of csv.split(/\r?\n/)) {
    if (!MARK.test(line)) continue
    const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''))
    if (cols[1]) names.add(cols[1])
  }
  return [...names]
}

async function cleanScheduledTasks(exec: HiddenExec, traces: HeadroomTrace[]): Promise<void> {
  let csv = ''
  try {
    csv = await exec('schtasks', ['/Query', '/V', '/FO', 'CSV', '/NH'])
  } catch {
    return
  }
  for (const name of headroomTaskNames(csv)) {
    try {
      await exec('schtasks', ['/Delete', '/TN', name, '/F'])
      traces.push({ where: `scheduled task ${name}`, action: 'removed', detail: 'deleted' })
    } catch {
      traces.push({ where: `scheduled task ${name}`, action: 'manual', detail: 'could not delete (may need admin)' })
    }
  }
}

async function cleanWindows(opts: HeadroomCleanupOptions, traces: HeadroomTrace[]): Promise<void> {
  const exec = opts.exec ?? hiddenExec
  cleanStartupFolder(opts, traces)
  await cleanRegistryValues(
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    (r) => MARK.test(r.name) || MARK.test(r.value),
    'run at login',
    exec,
    traces
  )
  await cleanEnvironment(exec, traces)
  await cleanScheduledTasks(exec, traces)
  try {
    await exec('taskkill', ['/F', '/T', '/IM', 'headroom.exe'])
    traces.push({ where: 'headroom.exe', action: 'removed', detail: 'running process stopped' })
  } catch {
    /* not running -- the usual case once the launch points are gone */
  }
}

// --------------------------------------------------------------------------- entry

/**
 * Finds and removes Headroom's launch points. Never throws: a cleanup that
 * fails must not take app start-up with it.
 */
export async function cleanHeadroom(opts: HeadroomCleanupOptions): Promise<HeadroomCleanupReport> {
  const traces: HeadroomTrace[] = []
  const steps: [string, () => void | Promise<void>][] = [
    ['shell profiles', () => cleanProfiles(opts, traces)],
    ['agent configs', () => cleanJsonConfigs(opts, traces)],
    ['codex config', () => cleanCodexToml(opts, traces)]
  ]
  if ((opts.platform ?? process.platform) === 'win32' && opts.includeSystem) {
    steps.push(['windows start-up', () => cleanWindows(opts, traces)])
  }
  for (const [name, step] of steps) {
    try {
      await step()
    } catch (err) {
      traces.push({
        where: name,
        action: 'manual',
        detail: `cleanup step failed: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }
  return { at: new Date().toISOString(), backupDir: opts.backupDir, traces }
}

/**
 * Put back a user Path that 0.98.0 deleted whole because one entry in it was
 * Headroom's.
 *
 * The registry no longer has it, but the running app still does: deleting a
 * value with `reg` does not tell Windows to refresh anyone's environment, so
 * Explorer -- and everything it started since, this app included -- kept the
 * old Path until the next sign-in. The user part is what the live Path holds
 * beyond the machine Path, minus Headroom's entries and the folders this app
 * adds for itself. Only when the user Path is really missing, and only if
 * there is something to put back; after a reboot there is not, and it stops.
 */
export async function repairUserPath(
  opts: { exec?: HiddenExec; env?: NodeJS.ProcessEnv; exclude?: string[] } = {}
): Promise<HeadroomTrace | null> {
  const exec = opts.exec ?? hiddenExec
  const env = opts.env ?? process.env
  const userKey = 'HKCU\\Environment'
  let user = ''
  try {
    user = await exec('reg', ['query', userKey])
  } catch {
    return null
  }
  if (parseRegValues(user).some((r) => r.name.toLowerCase() === 'path')) return null
  let machine = ''
  try {
    machine = await exec('reg', [
      'query',
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
      '/v',
      'Path'
    ])
  } catch {
    return null
  }
  const machinePath = parseRegValues(machine).find((r) => r.name.toLowerCase() === 'path')?.value ?? ''
  const lookup = (name: string): string | undefined => {
    const k = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase())
    return k ? env[k] : undefined
  }
  const norm = (p: string): string =>
    p
      .replace(/%([^%]+)%/g, (m, n: string) => lookup(n) ?? m)
      .trim()
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  const machineSet = new Set(machinePath.split(';').map(norm).filter(Boolean))
  const exclude = (opts.exclude ?? []).map(norm).filter(Boolean)
  const live = (lookup('Path') ?? '').split(';').map((p) => p.trim()).filter(Boolean)
  const seen = new Set<string>()
  const restored = live.filter((p) => {
    const n = norm(p)
    if (!n || machineSet.has(n) || seen.has(n)) return false
    seen.add(n)
    if (MARK.test(p)) return false
    return !exclude.some((x) => n === x || n.startsWith(`${x}\\`))
  })
  if (!restored.length) return null
  try {
    await exec('reg', ['add', userKey, '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', restored.join(';'), '/f'])
  } catch {
    return { where: `${userKey}\\Path`, action: 'manual', detail: 'user Path is missing and could not be written back' }
  }
  return {
    where: `${userKey}\\Path`,
    action: 'restored',
    detail: `user Path put back with ${restored.length} folder(s) from the live environment`,
    previous: restored.join(';')
  }
}

/** Whether a report found anything at all -- used to keep the log quiet on clean machines. */
export const foundHeadroom = (report: HeadroomCleanupReport): boolean => report.traces.length > 0

/** Whether a report removed anything -- the sign Headroom was (re)installed since last time. */
export const removedHeadroom = (report: HeadroomCleanupReport): boolean =>
  report.traces.some((t) => t.action === 'removed')
