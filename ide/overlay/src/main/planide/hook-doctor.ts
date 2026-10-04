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

/** One hook Codex runs around tools or turns -- shown so a failing one can be named. */
export type HookEntry = { file: string; event: string; matcher: string; command: string; ours: boolean }

export type HookDoctorReport = {
  at: string
  checked: number
  issues: HookIssue[]
  backupDir: string
  /** Every hook in the Codex hook files, the user's and Orca's managed homes'. */
  codex?: HookEntry[]
}

type Ctx = { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; home: string }

const OURS = /[\\/]\.config[\\/]pulsaride[\\/]hooks[\\/]/i
const SCRIPT_EXT = /\.(ps1|cmd|bat|py|mjs|cjs|js|sh|exe)$/i
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'bash', 'sh', 'zsh', 'deno', 'bun', 'uv', 'uvx'])
const SHELLS = new Set(['powershell', 'pwsh'])

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
  const report: HookDoctorReport = { at: new Date().toISOString(), checked: 0, issues: [], backupDir: opts.backupDir, codex: [] }
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
          if (agent === 'Codex') {
            for (const h of keptInner) {
              const command = String((h as { command?: unknown })?.command ?? '')
              report.codex?.push({
                file,
                event,
                matcher: String((group as { matcher?: unknown })?.matcher ?? ''),
                command,
                ours: OURS.test(command)
              })
            }
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

/** One Codex hook, run the way Codex runs it, and how that went. */
export type HookTest = HookEntry & { code: number | null; ok: boolean; output: string; ms: number }

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

/** What Codex hands a hook of this event on stdin -- a harmless shell call. */
function samplePayload(event: string, cwd: string): Record<string, unknown> {
  const base = {
    session_id: 'pulsaride-hook-test',
    transcript_path: null,
    cwd,
    hook_event_name: event,
    model: 'hook-test',
    permission_mode: 'default',
    turn_id: 'pulsaride-hook-test'
  }
  const tool = { tool_name: 'Bash', tool_use_id: 'pulsaride-hook-test', tool_input: { command: 'echo pulsaride-hook-test' } }
  switch (event) {
    case 'PreToolUse':
    case 'PermissionRequest':
      return { ...base, ...tool }
    case 'PostToolUse':
      return { ...base, ...tool, tool_response: 'pulsaride-hook-test' }
    case 'UserPromptSubmit':
      return { ...base, prompt: 'pulsaride hook test' }
    case 'Stop':
    case 'SubagentStop':
      return { ...base, stop_hook_active: true, last_assistant_message: '' }
    case 'SessionStart':
      return { ...base, source: 'startup' }
    default:
      return base
  }
}

/** Run one command in the given shell with `input` on stdin; never rejects. */
function runOnce(
  shell: { program: string; args: string[] },
  command: string,
  input: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; platform: NodeJS.Platform }
): Promise<{ code: number | null; output: string; ms: number }> {
  const started = Date.now()
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    const finish = (code: number | null, extra = ''): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      const text = (err.trim() || out.trim() || extra).replace(/\s+/g, ' ')
      resolve({ code, output: text.slice(-400), ms: Date.now() - started })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell.program, [...shell.args, command], {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (e) {
      resolve({ code: null, output: `could not start ${shell.program}: ${String(e)}`, ms: 0 })
      return
    }
    const timer = setTimeout(() => {
      if (opts.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        } catch {
          /* the kill below still ends it */
        }
      }
      child.kill()
      finish(null, `no answer in ${Math.round(opts.timeoutMs / 1000)} s`)
    }, opts.timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length < 8192) out += d.toString()
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

/**
 * Run every Codex hook once, the way Codex runs it, and say which ones fail.
 *
 * "Hook failed, exit code 1" names no hook, and a hook whose command line the
 * shell cannot parse fails before its own script -- and its log -- ever starts.
 * Only on the user's request (the Toolkit button): each hook is handed a
 * harmless sample of its event (an `echo` shell call) in an empty temp folder,
 * so a tracker or docs hook finds no project to act on. Each command runs once,
 * whichever files list it.
 */
export async function testCodexHooks(opts: {
  entries: HookEntry[]
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}): Promise<HookTest[]> {
  const platform = opts.platform ?? process.platform
  const env = { ...(opts.env ?? process.env) }
  // Outside an Orca pane, the way a hook would see a session that is not one.
  for (const k of Object.keys(env)) if (/^ORCA_(PANE_KEY|TAB_ID|AGENT_HOOK_)/i.test(k)) delete env[k]
  delete env.ELECTRON_RUN_AS_NODE
  const shell = codexHookShell({ platform, env })
  const cwd = mkdtempSync(join(tmpdir(), 'pulsaride-hook-test-'))
  const seen = new Map<string, HookTest>()
  const results: HookTest[] = []
  try {
    for (const entry of opts.entries) {
      if (!entry.command || entry.command === NOOP_COMMAND) continue
      const key = `${entry.event}\u0000${entry.command}`
      const earlier = seen.get(key)
      if (earlier) {
        results.push({ ...entry, code: earlier.code, ok: earlier.ok, output: earlier.output, ms: earlier.ms })
        continue
      }
      const input = `${JSON.stringify(samplePayload(entry.event, cwd))}\n`
      const run = await runOnce(shell, entry.command, input, { cwd, env, timeoutMs: opts.timeoutMs ?? 15000, platform })
      const result: HookTest = { ...entry, code: run.code, ok: run.code === 0, output: run.output, ms: run.ms }
      seen.set(key, result)
      results.push(result)
    }
  } finally {
    try {
      rmSync(cwd, { recursive: true, force: true })
    } catch {
      /* a temp folder the OS clears itself */
    }
  }
  return results
}

/**
 * Take one Codex hook out of action on the user's say-so: its command becomes
 * `exit 0` where it stands (Codex trusts by position), the file backed up
 * first. Every copy with that event and command in that file. Never throws.
 */
export function disableCodexHook(opts: {
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
