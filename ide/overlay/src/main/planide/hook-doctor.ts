/**
 * Agent hooks that cannot run, found and taken out.
 *
 * "Ik blijf dit 'hook failed, exit code 1' krijgen, en in het log staat
 * niets": PulsarIDE's own hooks never exit non-zero any more (writeNodeLauncher)
 * and log every failure, so an empty log means the failing hook is someone
 * else's -- one an installer, an older Orca or a removed tool left in the
 * agent's config. Codex runs every hook the user trusted, and one pointing at a
 * script that no longer exists fails on every single prompt.
 *
 * So on each launch every hook command in the agents' own config files is
 * read -- never run -- and checked:
 *  - a script or program given by its full path that is not on disk can never
 *    work: that hook is taken out of action (the file is backed up first).
 *    In Claude Code, Gemini CLI and Qwen Code it is removed. In Codex it stays
 *    where it is with its command replaced by `exit 0`: Codex records the
 *    user's trust per hook POSITION (codex-rs/hooks discovery: hook_key by
 *    group and handler index), so removing one would shift every hook after it
 *    -- PulsarIDE's included -- to a position whose trust no longer matches,
 *    and they would all stop running until re-approved;
 *  - a program named without a path that is not on PATH is reported, not
 *    removed: the agent may start with a different PATH than this app;
 *  - a path built from variables that cannot be resolved here is left alone.
 * PulsarIDE's own hooks are never touched here; deploying the bundle owns them.
 * Never throws.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative } from 'node:path'

export type HookIssue = {
  agent: string
  file: string
  event: string
  command: string
  problem: string
  /** Taken out of action (it could never run); false: reported only. */
  disabled: boolean
}

/**
 * One hook an agent runs around tools or turns -- shown so a failing one can be
 * named. `timeoutSec` is how long that agent lets it run (its own default when
 * the entry names none); `shell` is a shell the entry asks for itself.
 */
export type HookEntry = {
  agent: string
  file: string
  event: string
  matcher: string
  command: string
  ours: boolean
  timeoutSec: number
  shell?: string
}

export type HookDoctorReport = {
  at: string
  checked: number
  issues: HookIssue[]
  backupDir: string
  /** Every hook in the Codex hook files, the user's and Orca's managed homes'. */
  codex?: HookEntry[]
  /** Every hook of every agent: Codex, Claude Code, Gemini CLI, Qwen Code. */
  entries?: HookEntry[]
}

type Ctx = { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; home: string }

const OURS = /[\\/]\.config[\\/]pulsaride[\\/]hooks[\\/]/i
const SCRIPT_EXT = /\.(ps1|cmd|bat|py|mjs|cjs|js|sh|exe)$/i
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'bash', 'sh', 'zsh', 'deno', 'bun', 'uv', 'uvx'])
const SHELLS = new Set(['powershell', 'pwsh'])
/**
 * A command that opens with shell syntax is a small script, not a program and
 * its arguments: `if [ -f '<hook>' ]; then sh '<hook>'; else cat >/dev/null; fi`
 * is how Orca (1.4.2xx) writes its own managed hooks, guarding the missing-file
 * case itself. Nothing about it can be judged by reading its first word.
 */
const SHELL_SYNTAX = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select',
  'function', '[', '[[', 'test', '{', '(', '!', 'time', 'exec', 'command', 'builtin', 'eval', 'source', '.',
  'export', 'set', 'unset', 'true', 'false', ':', 'exit', 'echo', 'printf', 'cd', 'trap', 'read'
])

/** A command line split into words, honouring double and single quotes. */
export function splitCommand(command: string): string[] {
  const words: string[] = []
  let word = ''
  let quote = ''
  let started = false
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = ''
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started || word) words.push(word)
      word = ''
      started = false
    } else {
      word += ch
    }
  }
  if (started || word) words.push(word)
  return words
}

const progName = (word: string): string => basename(word).toLowerCase().replace(/\.exe$/, '')

/** %VAR%, $VAR, ${VAR} and a leading ~ resolved; null if anything is left unresolved. */
function expand(word: string, ctx: Ctx): string | null {
  const get = (name: string): string | undefined => {
    const key = Object.keys(ctx.env).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? ctx.env[key] : undefined
  }
  let out = word.replace(/^~(?=[\\/]|$)/, ctx.home)
  out = out.replace(/%([^%]+)%/g, (m, n: string) => get(n) ?? m)
  out = out.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a?: string, b?: string) => get((a ?? b) as string) ?? m)
  return /%[^%]+%|\$\{?[A-Za-z_]/.test(out) ? null : out
}

const absolute = (p: string): boolean => isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)

/** Whether a bare program name resolves on this PATH (with PATHEXT on Windows). */
function onPath(program: string, ctx: Ctx): boolean {
  const pathVar = Object.keys(ctx.env).find((k) => k.toLowerCase() === 'path')
  const dirs = (pathVar ? ctx.env[pathVar] ?? '' : '').split(ctx.platform === 'win32' ? ';' : delimiter).filter(Boolean)
  const exts =
    ctx.platform === 'win32'
      ? ['', ...(ctx.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())]
      : ['']
  return dirs.some((d) => exts.some((e) => existsSync(join(d, program + e))))
}

/**
 * What a hook command needs on disk: the files it names by full path, and the
 * program it starts if that is named without one.
 */
export function hookNeeds(command: string): { files: string[]; program: string | null } {
  const words = splitCommand(command.trim())
  if (!words.length) return { files: [], program: null }
  const first = words[0]
  const name = progName(first)
  const files: string[] = []
  let program: string | null = null
  if (absolute(first)) files.push(first)
  else program = first
  if (SHELLS.has(name)) {
    const i = words.findIndex((w) => /^-file$/i.test(w))
    if (i >= 0 && words[i + 1]) files.push(words[i + 1])
    else {
      // -Command "...": the script paths written inside it.
      const inner = words.slice(1).join(' ')
      for (const m of inner.matchAll(/(?:[A-Za-z]:[\\/]|\/)[^"';|&]+?\.(?:ps1|cmd|bat|py|mjs|cjs|js|sh|exe)\b/gi)) files.push(m[0])
    }
  } else if (name === 'cmd') {
    const i = words.findIndex((w) => /^\/[ck]$/i.test(w))
    if (i >= 0 && words[i + 1]) {
      const rest = hookNeeds(words.slice(i + 1).join(' '))
      files.push(...rest.files)
      if (rest.program) program = rest.program
    }
  } else if (INTERPRETERS.has(name)) {
    const script = words.slice(1).find((w) => !w.startsWith('-'))
    if (script && (absolute(script) || script.startsWith('~')) && SCRIPT_EXT.test(script)) files.push(script)
  }
  return { files, program }
}

/** What is wrong with one hook command, and whether that makes it impossible to run. */
function diagnose(command: string, ctx: Ctx): { problem: string; fatal: boolean } | null {
  const opening = splitCommand(command.trim())[0] ?? ''
  if (SHELL_SYNTAX.has(opening.toLowerCase()) || /^(if|for|while)\(/i.test(opening)) return null
  // PowerShell's call operator: what it calls is the command.
  if (opening === '&') return diagnose(command.trim().slice(1).trim(), ctx)
  const needs = hookNeeds(command)
  if (ctx.platform === 'win32') {
    // A shell script started on its own: Windows has nothing to run it with.
    const words = splitCommand(command.trim())
    if (words[0] && /\.sh$/i.test(words[0])) {
      return { problem: `a .sh script cannot run on Windows by itself: ${words[0]}`, fatal: true }
    }
    // bash/sh named without a path, and none on this machine: it never runs.
    const name = words[0] ? progName(words[0]) : ''
    if ((name === 'bash' || name === 'sh') && !absolute(words[0]) && !onPath(name, ctx)) {
      return { problem: `needs ${name}, and Windows has none on PATH`, fatal: true }
    }
  }
  for (const f of needs.files) {
    const path = expand(f, ctx)
    if (path === null) continue // built from variables only the agent knows
    if (!existsSync(path)) return { problem: `not on disk: ${path}`, fatal: true }
  }
  if (needs.program) {
    const prog = expand(needs.program, ctx)
    if (prog !== null && !absolute(prog) && !/[\\/]/.test(prog) && !onPath(prog, ctx)) {
      return { problem: `"${prog}" is not on PATH`, fatal: false }
    }
  }
  return null
}

/** remove: drop the hook. neutralize: keep its place, make it do nothing. */
type Config = { agent: string; file: string; mode?: 'remove' | 'neutralize' }

/** What a disabled Codex hook runs instead: nothing, successfully, in any shell. */
export const NOOP_COMMAND = 'exit 0'

/**
 * The agents' hook files. `codexHomes` adds the CODEX_HOMEs Orca runs Codex in
 * (codex-runtime-home/home, codex-accounts/<id>/home): Codex reads the hooks
 * of the home it runs in, and Orca mirrors the user's into those.
 */
export function hookConfigs(home: string, codexHomes: string[] = []): Config[] {
  return [
    { agent: 'Codex', file: join(home, '.codex', 'hooks.json'), mode: 'neutralize' },
    ...codexHomes.map((h) => ({ agent: 'Codex', file: join(h, 'hooks.json'), mode: 'neutralize' as const })),
    { agent: 'Claude Code', file: join(home, '.claude', 'settings.json') },
    { agent: 'Gemini CLI', file: join(home, '.gemini', 'settings.json') },
    { agent: 'Qwen Code', file: join(home, '.qwen', 'settings.json') }
  ]
}

function backup(file: string, opts: { home: string; backupDir: string }): void {
  const rel = relative(opts.home, file)
  const target = join(opts.backupDir, rel.startsWith('..') ? basename(file) : rel)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(file, target)
}

/** Check every agent's hooks; take out the ones that can never run. Never throws. */
export function doctorHooks(opts: {
  home?: string
  backupDir: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  configs?: Config[]
  codexHomes?: string[]
}): HookDoctorReport {
  const home = opts.home ?? homedir()
  const ctx: Ctx = { platform: opts.platform ?? process.platform, env: opts.env ?? process.env, home }
  const report: HookDoctorReport = {
    at: new Date().toISOString(),
    checked: 0,
    issues: [],
    backupDir: opts.backupDir,
    codex: [],
    entries: []
  }
  for (const { agent, file, mode } of opts.configs ?? hookConfigs(home, opts.codexHomes)) {
    try {
      if (!existsSync(file)) continue
      const config = JSON.parse(readFileSync(file, 'utf8') || '{}') as { hooks?: Record<string, unknown> }
      const hooks = config.hooks
      if (!hooks || typeof hooks !== 'object') continue
      let changed = false
      for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) continue
        const keptGroups: unknown[] = []
        for (const group of groups) {
          const inner = (group as { hooks?: unknown[] })?.hooks
          if (!Array.isArray(inner)) {
            keptGroups.push(group)
            continue
          }
          const keptInner = inner.filter((h) => {
            const hook = h as { type?: string; command?: unknown }
            if (hook?.type && hook.type !== 'command') return true
            const command = typeof hook?.command === 'string' ? hook.command : ''
            if (!command || command === NOOP_COMMAND || OURS.test(command)) return true
            report.checked += 1
            const found = diagnose(command, ctx)
            if (!found) return true
            report.issues.push({ agent, file, event, command: command.slice(0, 300), problem: found.problem, disabled: found.fatal })
            if (!found.fatal) return true
            if (mode === 'neutralize') {
              ;(hook as { command: string }).command = NOOP_COMMAND
              changed = true
              return true
            }
            return false
          })
          if (keptInner.length !== inner.length) changed = true
          for (const h of keptInner) {
            const hook = h as { type?: string; command?: unknown; shell?: unknown }
            if (hook?.type && hook.type !== 'command') continue
            const command = String(hook?.command ?? '')
            if (!command) continue
            const entry: HookEntry = {
              agent,
              file,
              event,
              matcher: String((group as { matcher?: unknown })?.matcher ?? ''),
              command,
              ours: OURS.test(command),
              timeoutSec: agentTimeoutSec(agent, h),
              ...(typeof hook.shell === 'string' && hook.shell ? { shell: hook.shell } : {})
            }
            report.entries?.push(entry)
            if (agent === 'Codex') report.codex?.push(entry)
          }
          if (keptInner.length) keptGroups.push({ ...(group as object), hooks: keptInner })
        }
        hooks[event] = keptGroups
      }
      if (changed) {
        backup(file, { home, backupDir: opts.backupDir })
        const tmp = `${file}.pulsar-${process.pid}.tmp`
        writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`)
        renameSync(tmp, file)
      }
    } catch {
      /* a config we cannot read is the agent's to report, not ours to rewrite */
    }
  }
  return report
}

/** One hook, run the way its agent runs it, and what that agent would make of it. */
export type HookTest = HookEntry & {
  code: number | null
  ok: boolean
  /** failed: the agent shows an error. blocked: it stops the sample call, on purpose. */
  verdict: 'ok' | 'failed' | 'blocked'
  /** What the agent itself reports, in its own words where it has them. */
  problem: string
  output: string
  ms: number
}

/** The test waits at most this long for one hook, whatever its agent would allow. */
const TEST_CAP_SEC = 60

/**
 * How long an agent lets one hook run, in seconds: the entry's own value in that
 * agent's unit, or the agent's default.
 */
export function agentTimeoutSec(agent: string, hook: unknown): number {
  const raw = (hook as { timeout?: unknown } | null)?.timeout
  const n = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
  switch (agent) {
    case 'Codex':
      // codex-rs/config hook_config.rs: `timeout`, seconds, default 600. The
      // `timeoutSec` earlier PulsarIDE versions wrote is not a field it reads.
      return n ?? 600
    case 'Gemini CLI':
      // Milliseconds, default 60000 (Gemini CLI docs/hooks/reference.md).
      return n ? n / 1000 : 60
    case 'Qwen Code':
      // Seconds; 1000 or more is still read as milliseconds.
      return n ? (n >= 1000 ? n / 1000 : n) : 60
    default:
      // Claude Code: seconds, default 60.
      return n ?? 60
  }
}

type Shell = { program: string; args: string[]; label: string; verbatim?: boolean }

/**
 * The shell Codex hands a hook command to. Checked in openai/codex: the
 * session's user shell (codex-rs/core session hooks config), detected as pwsh
 * before Windows PowerShell on Windows (shell_detect, with the same fallback
 * paths), started `-NoProfile -Command <command>` (shell.rs derive_exec_args).
 * Elsewhere the user's $SHELL with `-c`.
 */
export function codexHookShell(opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}): {
  program: string
  args: string[]
} {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const ctx: Ctx = { platform, env, home: homedir() }
  if (platform === 'win32') {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
    const program = onPath('pwsh', ctx)
      ? 'pwsh.exe'
      : existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
        ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
        : onPath('powershell', ctx)
          ? 'powershell.exe'
          : join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return { program, args: ['-NoProfile', '-Command'] }
  }
  return { program: env.SHELL || '/bin/sh', args: ['-c'] }
}

/** Windows PowerShell, as Gemini CLI and a `"shell": "powershell"` entry start it. */
function windowsPowerShell(ctx: Ctx): Shell {
  const root = ctx.env.SystemRoot ?? ctx.env.SYSTEMROOT ?? 'C:\\Windows'
  const program = onPath('powershell', ctx)
    ? 'powershell.exe'
    : join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return { program, args: ['-NoProfile', '-Command'], label: 'PowerShell' }
}

/**
 * The Git Bash Claude Code runs hooks in on Windows (code.claude.com/docs/en/hooks.md,
 * "Shell form"): CLAUDE_CODE_GIT_BASH_PATH, else where Git for Windows installs
 * it. Never WSL's bash.exe in System32 -- Claude Code does not use that one.
 */
function gitBash(ctx: Ctx): string | null {
  const get = (name: string): string | undefined => {
    const key = Object.keys(ctx.env).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? ctx.env[key] : undefined
  }
  const explicit = get('CLAUDE_CODE_GIT_BASH_PATH')
  if (explicit && existsSync(explicit)) return explicit
  const roots = [get('ProgramFiles'), get('ProgramFiles(x86)'), get('LOCALAPPDATA') && join(get('LOCALAPPDATA') as string, 'Programs')]
  for (const r of roots) {
    if (!r) continue
    const candidate = join(r, 'Git', 'bin', 'bash.exe')
    if (existsSync(candidate)) return candidate
  }
  return existsSync('C:\\Program Files\\Git\\bin\\bash.exe') ? 'C:\\Program Files\\Git\\bin\\bash.exe' : null
}

/** The shell `agent` runs a hook command in, as that agent's own code does. */
export function agentHookShell(
  agent: string,
  entryShell: string | undefined,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}
): Shell {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const ctx: Ctx = { platform, env, home: homedir() }
  const want = String(entryShell ?? '').toLowerCase()
  const posixBash = (): Shell =>
    onPath('bash', ctx) ? { program: 'bash', args: ['-c'], label: 'bash' } : { program: '/bin/sh', args: ['-c'], label: 'sh' }
  if (agent === 'Codex') {
    const shell = codexHookShell({ platform, env })
    return { ...shell, label: platform === 'win32' ? 'PowerShell' : basename(shell.program) }
  }
  if (want === 'powershell' || want === 'pwsh') {
    if (platform === 'win32') return windowsPowerShell(ctx)
    return { program: 'pwsh', args: ['-NoProfile', '-Command'], label: 'PowerShell' }
  }
  if (agent === 'Gemini CLI') return platform === 'win32' ? windowsPowerShell(ctx) : posixBash()
  if (agent === 'Qwen Code') {
    if (want === 'bash') return posixBash()
    if (platform === 'win32') {
      return { program: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', args: ['/d', '/s', '/c'], label: 'cmd', verbatim: true }
    }
    return posixBash()
  }
  // Claude Code.
  if (platform === 'win32') {
    const bash = gitBash(ctx)
    return bash ? { program: bash, args: ['-c'], label: 'Git Bash' } : windowsPowerShell(ctx)
  }
  return { program: '/bin/sh', args: ['-c'], label: 'sh' }
}

/**
 * What the agent hands a hook of this event on stdin -- a harmless shell call.
 * The prompt is "ga door": in a tracked project that is the prompt PulsarIDE's
 * own hook answers, so its real answer is what gets judged.
 */
function samplePayload(agent: string, event: string, cwd: string): Record<string, unknown> {
  const base = {
    session_id: 'pulsaride-hook-test',
    transcript_path: null,
    cwd,
    hook_event_name: event,
    model: 'hook-test',
    permission_mode: 'default',
    turn_id: 'pulsaride-hook-test'
  }
  const toolName = agent === 'Gemini CLI' || agent === 'Qwen Code' ? 'run_shell_command' : 'Bash'
  const tool = { tool_name: toolName, tool_use_id: 'pulsaride-hook-test', tool_input: { command: 'echo pulsaride-hook-test' } }
  switch (event) {
    case 'PreToolUse':
    case 'PermissionRequest':
    case 'BeforeTool':
      return { ...base, ...tool }
    case 'PostToolUse':
    case 'AfterTool':
      return { ...base, ...tool, tool_response: 'pulsaride-hook-test' }
    case 'UserPromptSubmit':
    case 'BeforeAgent':
      return { ...base, prompt: 'ga door' }
    case 'Stop':
    case 'SubagentStop':
    case 'AfterAgent':
      return { ...base, stop_hook_active: true, last_assistant_message: '', prompt_response: '' }
    case 'SessionStart':
      return { ...base, source: 'startup' }
    default:
      return base
  }
}

type RunResult = { code: number | null; stdout: string; stderr: string; error: string; timedOut: boolean; ms: number }

/** Run one command in the given shell with `input` on stdin; never rejects. */
function runOnce(
  shell: Shell,
  command: string,
  input: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; platform: NodeJS.Platform }
): Promise<RunResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    let timedOut = false
    const finish = (code: number | null, error = ''): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout: out, stderr: err, error, timedOut, ms: Date.now() - started })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell.program, [...shell.args, shell.verbatim ? `"${command}"` : command], {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: Boolean(shell.verbatim)
      })
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: '', error: `could not start ${shell.program}: ${String(e)}`, timedOut: false, ms: 0 })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (opts.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        } catch {
          /* the kill below still ends it */
        }
      }
      child.kill()
      finish(null)
    }, opts.timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length < 65536) out += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (err.length < 8192) err += d.toString()
    })
    child.on('error', (e) => finish(null, `could not start ${shell.program}: ${e.message}`))
    child.on('close', (code) => finish(code))
    child.stdin?.on('error', () => {
      /* a hook that never reads stdin closes it early: not a failure */
    })
    child.stdin?.end(input)
  })
}

const looksLikeJson = (text: string): boolean => /^\s*[[{]/.test(text)

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text.trim()) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Codex's own names for its events in error texts (events/*.rs). */
const CODEX_LABEL: Record<string, string> = {
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  PermissionRequest: 'permission request',
  SessionStart: 'session start',
  SubagentStart: 'subagent start',
  UserPromptSubmit: 'user prompt submit',
  Stop: 'stop hook',
  SubagentStop: 'subagent stop hook',
  PreCompact: 'pre-compact',
  PostCompact: 'post-compact'
}

const CODEX_EVENTS = new Set([
  'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionStart',
  'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'
])

type Field = 'bool' | 'str?' | 'obj?' | 'any' | `enum:${string}`

/**
 * Whether an object matches one of Codex's output structs: every key known
 * (`deny_unknown_fields`), every value of its type. codex-rs/hooks/src/schema.rs.
 */
function fitsCodexWire(obj: Record<string, unknown>, fields: Record<string, Field>, required: string[] = []): boolean {
  for (const key of required) if (!(key in obj)) return false
  for (const [key, value] of Object.entries(obj)) {
    const type = fields[key]
    if (!type) return false
    if (type === 'any') continue
    if (type === 'bool') {
      if (typeof value !== 'boolean') return false
    } else if (type === 'str?') {
      if (value !== null && typeof value !== 'string') return false
    } else if (type === 'obj?') {
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) return false
    } else if (type.startsWith('enum:')) {
      if (value !== null && !type.slice(5).split('|').includes(String(value))) return false
    }
  }
  return true
}

const UNIVERSAL: Record<string, Field> = { continue: 'bool', stopReason: 'str?', suppressOutput: 'bool', systemMessage: 'str?' }
const EVENT_NAME: Field = `enum:${[...CODEX_EVENTS].join('|')}`

/** Null when Codex accepts this stdout for this event; else what Codex reports. */
export function codexOutputProblem(event: string, stdout: string): string | null {
  const text = stdout.trim()
  if (!text) return null
  const label = CODEX_LABEL[event] ?? event
  const invalid = `hook returned invalid ${label} JSON output`
  const obj = jsonObject(text)
  const specific = (keys: Record<string, Field>): boolean => {
    const h = obj?.hookSpecificOutput
    return h === undefined || h === null || fitsCodexWire(h as Record<string, unknown>, { hookEventName: EVENT_NAME, ...keys }, ['hookEventName'])
  }
  const blockWithoutReason = (): string | null =>
    obj?.decision === 'block' && !String(obj?.reason ?? '').trim()
      ? `${event} hook returned decision:block without a non-empty reason`
      : null
  // Stop: anything that is not its JSON fails (events/stop.rs).
  if (event === 'Stop' || event === 'SubagentStop') {
    if (!obj || !fitsCodexWire(obj, { ...UNIVERSAL, decision: 'enum:block', reason: 'str?' })) return invalid
    return blockWithoutReason()
  }
  // Plain text: context for SessionStart / UserPromptSubmit, ignored elsewhere.
  if (!looksLikeJson(text)) return null
  if (!obj) return invalid
  switch (event) {
    case 'SessionStart':
    case 'SubagentStart':
      return fitsCodexWire(obj, { ...UNIVERSAL, hookSpecificOutput: 'obj?' }) && specific({ additionalContext: 'str?' })
        ? null
        : invalid
    case 'UserPromptSubmit':
      if (!fitsCodexWire(obj, { ...UNIVERSAL, decision: 'enum:block', reason: 'str?', hookSpecificOutput: 'obj?' })) return invalid
      if (!specific({ additionalContext: 'str?' })) return invalid
      return blockWithoutReason()
    case 'PostToolUse': {
      if (!fitsCodexWire(obj, { ...UNIVERSAL, decision: 'enum:block', reason: 'str?', hookSpecificOutput: 'obj?' })) return invalid
      if (!specific({ additionalContext: 'str?', updatedMCPToolOutput: 'any' })) return invalid
      const h = (obj.hookSpecificOutput ?? {}) as Record<string, unknown>
      if (obj.suppressOutput === true) return 'PostToolUse hook returned unsupported suppressOutput'
      if (h.updatedMCPToolOutput !== undefined && h.updatedMCPToolOutput !== null) {
        return 'PostToolUse hook returned unsupported updatedMCPToolOutput'
      }
      if (obj.decision !== 'block' && obj.continue !== false && typeof obj.reason === 'string') {
        return 'PostToolUse hook returned reason without decision'
      }
      return blockWithoutReason()
    }
    case 'PreToolUse': {
      const fields = { ...UNIVERSAL, decision: 'enum:approve|block' as Field, reason: 'str?' as Field, hookSpecificOutput: 'obj?' as Field }
      if (!fitsCodexWire(obj, fields)) return invalid
      if (
        !specific({
          permissionDecision: 'enum:allow|deny|ask',
          permissionDecisionReason: 'str?',
          updatedInput: 'any',
          additionalContext: 'str?'
        })
      ) {
        return invalid
      }
      if (obj.continue === false) return 'PreToolUse hook returned unsupported continue:false'
      if (typeof obj.stopReason === 'string') return 'PreToolUse hook returned unsupported stopReason'
      if (obj.suppressOutput === true) return 'PreToolUse hook returned unsupported suppressOutput'
      const h = (obj.hookSpecificOutput ?? {}) as Record<string, unknown>
      const hasValue = (v: unknown): boolean => v !== undefined && v !== null
      if (hasValue(h.permissionDecision) || hasValue(h.permissionDecisionReason) || hasValue(h.updatedInput)) {
        if (hasValue(h.updatedInput) && h.permissionDecision !== 'allow') {
          return 'PreToolUse hook returned updatedInput without permissionDecision:allow'
        }
        if (h.permissionDecision === 'allow' && !hasValue(h.updatedInput)) {
          return 'PreToolUse hook returned unsupported permissionDecision:allow'
        }
        if (h.permissionDecision === 'ask') return 'PreToolUse hook returned unsupported permissionDecision:ask'
        if (h.permissionDecision === 'deny' && !String(h.permissionDecisionReason ?? '').trim()) {
          return 'PreToolUse hook returned permissionDecision:deny without a non-empty permissionDecisionReason'
        }
        if (!hasValue(h.permissionDecision)) {
          return 'PreToolUse hook returned permissionDecisionReason without permissionDecision'
        }
        return null
      }
      if (obj.decision === 'approve') return 'PreToolUse hook returned unsupported decision:approve'
      if (obj.decision === 'block') return String(obj.reason ?? '').trim() ? null : `PreToolUse hook returned decision:block without a non-empty reason`
      if (typeof obj.reason === 'string') return 'PreToolUse hook returned reason without decision'
      return null
    }
    default:
      return null
  }
}

/** Whether this stdout blocks the call or the turn, in the agent's terms. */
function blocks(agent: string, event: string, stdout: string): string | null {
  const obj = jsonObject(stdout)
  if (!obj) return null
  const h = (obj.hookSpecificOutput ?? {}) as Record<string, unknown>
  if (h.permissionDecision === 'deny') return String(h.permissionDecisionReason ?? 'denied')
  if (obj.decision === 'block' || obj.decision === 'deny') {
    // A Stop that "blocks" is the autopilot carrying on -- intended, not a block.
    if (event === 'Stop' || event === 'SubagentStop' || event === 'AfterAgent') return null
    return String(obj.reason ?? 'blocked')
  }
  if (agent !== 'Codex' && obj.continue === false) return String(obj.stopReason ?? 'stopped')
  return null
}

/** What `agent` makes of one run of a hook: fine, an error it shows you, or a deliberate block. */
export function judgeHookRun(
  agent: string,
  event: string,
  run: RunResult,
  limits: { timeoutSec: number; capSec: number }
): { verdict: HookTest['verdict']; problem: string } {
  if (run.error) return { verdict: 'failed', problem: run.error }
  if (run.timedOut) {
    return limits.timeoutSec <= limits.capSec
      ? { verdict: 'failed', problem: `no answer in ${limits.timeoutSec} s -- ${agent} stops it there and reports a hook error` }
      : {
          verdict: 'failed',
          problem: `still running after ${limits.capSec} s -- ${agent} waits up to ${limits.timeoutSec} s for it before going on`
        }
  }
  const stderr = run.stderr.trim()
  if (agent === 'Codex') {
    if (run.code === 0) {
      const problem = codexOutputProblem(event, run.stdout)
      if (problem) return { verdict: 'failed', problem }
      const why = blocks(agent, event, run.stdout)
      return why ? { verdict: 'blocked', problem: `blocks the sample call: ${why}` } : { verdict: 'ok', problem: '' }
    }
    if (run.code === 2) {
      return stderr
        ? { verdict: 'blocked', problem: `blocks the sample call: ${stderr}` }
        : { verdict: 'failed', problem: `${event} hook exited with code 2 but did not write a blocking reason to stderr` }
    }
    if (run.code === null) return { verdict: 'failed', problem: 'hook exited without a status code' }
    return { verdict: 'failed', problem: `hook exited with code ${run.code}` }
  }
  // Claude Code, Gemini CLI, Qwen Code: exit 0 with JSON that parses, exit 2 blocks.
  if (run.code === 0) {
    if (looksLikeJson(run.stdout) && !jsonObject(run.stdout)) {
      return { verdict: 'failed', problem: `${event} hook error: its output starts like JSON but does not parse` }
    }
    const why = blocks(agent, event, run.stdout)
    return why ? { verdict: 'blocked', problem: `blocks the sample call: ${why}` } : { verdict: 'ok', problem: '' }
  }
  if (run.code === 2) return { verdict: 'blocked', problem: `blocks the sample call: ${stderr || 'exit code 2'}` }
  if (run.code === null) return { verdict: 'failed', problem: `${event} hook error: ended without an exit code` }
  return { verdict: 'failed', problem: `${event} hook error: exited with code ${run.code}${stderr ? ` -- ${stderr.slice(-200)}` : ''}` }
}

/**
 * A throwaway copy of a tracked project for the hooks to work on: its board
 * (.planide/state.json) and a .git folder, nothing else. So PulsarIDE's hooks
 * take the same path -- and print the same answer -- as in the real project,
 * and the real one is never written to. Null when there is no board to copy.
 */
function sandboxProject(root: string, project: string | undefined): string | null {
  try {
    if (!project) return null
    const state = join(project, '.planide', 'state.json')
    if (!existsSync(state)) return null
    const dir = join(root, basename(project) || 'project')
    mkdirSync(join(dir, '.planide'), { recursive: true })
    mkdirSync(join(dir, '.git'), { recursive: true })
    copyFileSync(state, join(dir, '.planide', 'state.json'))
    for (const name of ['VERSION', 'package.json']) {
      if (existsSync(join(project, name))) copyFileSync(join(project, name), join(dir, name))
    }
    return dir
  } catch {
    return null
  }
}

/**
 * Run every agent's hooks once, the way each agent runs them, and say which
 * ones that agent would report.
 *
 * "Ik blijf hookserror krijgen en in log staat niets ... met jou hooks test werkt
 * alles": the first version of this test ran only Codex's hooks, in an empty
 * folder, and called a hook fine when it exited 0. So Claude Code's hooks were
 * never run at all; PulsarIDE's own hooks, finding no board in an empty folder,
 * never got as far as answering; and an answer an agent rejects (Codex: JSON
 * that is not exactly its schema), or one that comes too late, passed. Now:
 *  - Codex, Claude Code, Gemini CLI and Qwen Code, each in the shell that agent
 *    uses and with the time limit it gives the hook;
 *  - with `project`, in a throwaway copy of that project's board, so the hooks
 *    do their real work and print their real answer;
 *  - judged as the agent judges it: exit code, time, and the output itself.
 * Only on the user's request (the Toolkit button). Each command runs once per
 * agent and event, whichever files list it.
 */
export async function testHooks(opts: {
  entries: HookEntry[]
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  project?: string
  capSec?: number
}): Promise<HookTest[]> {
  const platform = opts.platform ?? process.platform
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) }
  // Outside an Orca pane, the way a hook would see a session that is not one:
  // the IDE's own status hooks must not report a pane that does not exist.
  for (const k of Object.keys(env)) if (/^ORCA_(PANE_KEY|TAB_ID|AGENT_HOOK_)/i.test(k)) delete env[k]
  delete env.ELECTRON_RUN_AS_NODE
  // Tells the session-start bootstrap not to start a real memory sync on the copy.
  env.PULSAR_HOOK_TEST = '1'
  const capSec = opts.capSec ?? TEST_CAP_SEC
  const root = mkdtempSync(join(tmpdir(), 'pulsaride-hook-test-'))
  const cwd = sandboxProject(root, opts.project) ?? root
  const seen = new Map<string, HookTest>()
  const results: HookTest[] = []
  try {
    for (const entry of opts.entries) {
      if (!entry.command || entry.command === NOOP_COMMAND) continue
      const key = `${entry.agent}\u0000${entry.event}\u0000${entry.command}`
      const earlier = seen.get(key)
      if (earlier) {
        results.push({ ...entry, code: earlier.code, ok: earlier.ok, verdict: earlier.verdict, problem: earlier.problem, output: earlier.output, ms: earlier.ms })
        continue
      }
      const shell = agentHookShell(entry.agent, entry.shell, { platform, env })
      const input = `${JSON.stringify(samplePayload(entry.agent, entry.event, cwd))}\n`
      const limit = Math.min(entry.timeoutSec || 60, capSec)
      const run = await runOnce(shell, entry.command, input, { cwd, env, timeoutMs: limit * 1000, platform })
      const judged = judgeHookRun(entry.agent, entry.event, run, { timeoutSec: entry.timeoutSec || 60, capSec })
      const shown = (run.stderr.trim() || run.stdout.trim()).replace(/\s+/g, ' ').slice(-400)
      const result: HookTest = {
        ...entry,
        code: run.code,
        ok: judged.verdict === 'ok',
        verdict: judged.verdict,
        problem: judged.problem,
        output: shown,
        ms: run.ms
      }
      seen.set(key, result)
      results.push(result)
    }
  } finally {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* a temp folder the OS clears itself */
    }
  }
  return results
}

/** The Codex hooks only -- what the Toolkit's test covered before every agent was in it. */
export async function testCodexHooks(opts: {
  entries: HookEntry[]
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}): Promise<HookTest[]> {
  return testHooks({
    entries: opts.entries.filter((e) => (e.agent ?? 'Codex') === 'Codex'),
    platform: opts.platform,
    env: opts.env,
    capSec: opts.timeoutMs ? opts.timeoutMs / 1000 : undefined
  })
}

/**
 * Take one hook out of action on the user's say-so: its command becomes
 * `exit 0` where it stands (Codex trusts by position; the others do not mind),
 * the file backed up first. Every copy with that event and command in that
 * file. `exit 0` does nothing, successfully, in every shell an agent uses.
 * Never throws.
 */
export function disableHook(opts: {
  file: string
  event: string
  command: string
  backupDir: string
  home?: string
}): boolean {
  try {
    if (!existsSync(opts.file)) return false
    const config = JSON.parse(readFileSync(opts.file, 'utf8') || '{}') as { hooks?: Record<string, unknown> }
    const groups = config.hooks?.[opts.event]
    if (!Array.isArray(groups)) return false
    let changed = false
    for (const group of groups) {
      const inner = (group as { hooks?: unknown[] })?.hooks
      if (!Array.isArray(inner)) continue
      for (const h of inner) {
        const hook = h as { command?: unknown }
        if (hook && hook.command === opts.command) {
          hook.command = NOOP_COMMAND
          changed = true
        }
      }
    }
    if (!changed) return false
    backup(opts.file, { home: opts.home ?? homedir(), backupDir: opts.backupDir })
    const tmp = `${opts.file}.pulsar-${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`)
    renameSync(tmp, opts.file)
    return true
  } catch {
    return false
  }
}

/** Kept for callers from before every agent's hooks could be turned off. */
export const disableCodexHook = disableHook
