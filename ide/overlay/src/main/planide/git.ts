/**
 * Git / GitHub operations for a tracked project, run from the main process.
 *
 * Shells out to the real `git` binary — no library, no stored credentials: a
 * push uses whatever auth the user already has (credential helper, SSH key,
 * gh). Every call runs headless:
 *   GIT_TERMINAL_PROMPT=0  — never block on an interactive auth prompt
 *   stdin: 'ignore'        — never inherit a TTY a read can hang on
 *   timeout                — never hang the IDE
 */

import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, appendFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { SKIP_DIRS } from './detect'

const DEFAULT_TIMEOUT = 120_000

export type GitStatus = {
  ok: boolean
  has_git: boolean
  path: string
  branch?: string
  dirty?: boolean
  changed?: string[]
  changed_count?: number
  remote?: string
  has_remote?: boolean
  ahead?: number
  behind?: number
  upstream?: boolean
  last_commit?: string
  error?: string
}

function git(
  cwd: string,
  args: string[],
  timeout = DEFAULT_TIMEOUT
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        timeout,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
        maxBuffer: 8 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '').trim()
        const err = String(stderr ?? '').trim()
        if (error) {
          const code = typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : 1
          resolve({ code, out, err: err || error.message })
          return
        }
        resolve({ code: 0, out, err })
      }
    )
  })
}

export async function hasGit(path: string): Promise<boolean> {
  const r = await git(path, ['rev-parse', '--is-inside-work-tree'])
  return r.code === 0 && r.out === 'true'
}

export async function status(path: string): Promise<GitStatus> {
  if (!existsSync(path)) return { ok: false, has_git: false, path, error: 'no such directory' }
  if (!(await hasGit(path))) return { ok: true, has_git: false, path }

  const branch = (await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).out
  const porcelain = (await git(path, ['status', '--porcelain'])).out
  const changed = porcelain.split('\n').filter((l) => l.trim())
  const remote = (await git(path, ['remote', 'get-url', 'origin'])).out

  let ahead = 0
  let behind = 0
  let upstream = false
  const counts = await git(path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  if (counts.code === 0 && counts.out) {
    const parts = counts.out.split(/\s+/)
    if (parts.length === 2) {
      behind = Number(parts[0]) || 0
      ahead = Number(parts[1]) || 0
      upstream = true
    }
  }
  const last = (await git(path, ['log', '-1', '--pretty=%h  %s  (%cr)'])).out

  return {
    ok: true, has_git: true, path, branch,
    dirty: changed.length > 0,
    changed: changed.slice(0, 100),
    changed_count: changed.length,
    remote, has_remote: Boolean(remote),
    ahead, behind, upstream,
    last_commit: last
  }
}

const DEFAULT_IGNORES = [
  '.planide/backups/', 'node_modules/', '__pycache__/', '*.pyc', '.venv/',
  'venv/', 'dist/', 'build/', 'target/', '.DS_Store'
]

function seedGitignore(path: string): void {
  const gi = join(path, '.gitignore')
  let existing = ''
  try {
    existing = readFileSync(gi, 'utf8')
  } catch {
    /* no .gitignore yet */
  }
  const add = DEFAULT_IGNORES.filter((line) => !existing.includes(line))
  if (!add.length) return
  const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
  appendFileSync(gi, `${prefix}\n# added by PlanIDE\n${add.join('\n')}\n`, 'utf8')
}

export async function init(path: string, branch = 'main'): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (await hasGit(path)) return { ok: true, message: 'already a git repo' }
  let r = await git(path, ['init', '-b', branch])
  if (r.code !== 0) {
    // Older git without -b.
    r = await git(path, ['init'])
    if (r.code === 0) await git(path, ['checkout', '-b', branch])
  }
  if (r.code !== 0) return { ok: false, error: r.err || r.out }
  seedGitignore(path)
  return { ok: true, message: `initialised git repo on '${branch}'` }
}

export async function setRemote(path: string, url: string): Promise<{ ok: boolean; remote: string }> {
  if (!(await hasGit(path))) await init(path)
  const existing = await git(path, ['remote', 'get-url', 'origin'])
  if (existing.code === 0) await git(path, ['remote', 'set-url', 'origin', url])
  else await git(path, ['remote', 'add', 'origin', url])
  return { ok: true, remote: url }
}

export type LargeFile = { path: string; size: number; size_mb: number; ext: string }

/** Files above the threshold — the ones GitHub rejects without Git LFS. */
export function largeFiles(path: string, thresholdMb = 50): {
  ok: boolean
  threshold_mb: number
  count: number
  files: LargeFile[]
  extensions: string[]
} {
  const threshold = thresholdMb * 1024 * 1024
  const big: LargeFile[] = []

  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name) || name === '.git') continue
        walk(full)
        continue
      }
      if (st.size >= threshold) {
        big.push({
          path: relative(path, full),
          size: st.size,
          size_mb: Math.round((st.size / 1024 / 1024) * 10) / 10,
          ext: extname(name).toLowerCase() || '(none)'
        })
      }
    }
  }
  walk(path)
  big.sort((a, b) => b.size - a.size)
  return {
    ok: true,
    threshold_mb: thresholdMb,
    count: big.length,
    files: big.slice(0, 200),
    extensions: [...new Set(big.map((b) => b.ext).filter((e) => e !== '(none)'))].sort()
  }
}

export async function trackLfs(
  path: string,
  patterns: string[]
): Promise<{ ok: boolean; installed: boolean; tracked?: string[]; error?: string }> {
  const version = await git(path, ['lfs', 'version'])
  if (version.code !== 0) {
    return {
      ok: false,
      installed: false,
      error: 'git-lfs is not installed. Install it: https://git-lfs.com then re-run.'
    }
  }
  if (!(await hasGit(path))) await init(path)
  await git(path, ['lfs', 'install', '--local'])
  const tracked: string[] = []
  for (const raw of patterns) {
    let p = raw.trim()
    if (!p) continue
    // Accept ".zip" as well as "*.zip" or a path.
    if (p.startsWith('.') && !p.includes('/') && !p.includes('*')) p = `*${p}`
    const r = await git(path, ['lfs', 'track', p])
    if (r.code === 0) tracked.push(p)
  }
  return { ok: true, installed: true, tracked }
}

export type SyncResult = {
  ok: boolean
  committed: boolean
  pushed: boolean
  branch: string
  log: string[]
  push_error: string
}

/** Stage everything, commit, and optionally push with exponential backoff. */
export async function sync(
  path: string,
  opts: { message?: string; push?: boolean; branch?: string; retries?: number } = {}
): Promise<SyncResult> {
  const log: string[] = []
  const push = opts.push ?? true
  const retries = opts.retries ?? 4

  if (!(await hasGit(path))) {
    const r = await init(path, opts.branch || 'main')
    log.push(r.message ?? 'init')
  }
  const branch = opts.branch || (await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).out || 'main'

  await git(path, ['add', '-A'])
  const porcelain = (await git(path, ['status', '--porcelain'])).out
  let committed = false
  if (porcelain.trim()) {
    const message = (opts.message ?? '').trim() || 'PlanIDE: sync tracker + project state'
    const r = await git(path, ['commit', '-m', message])
    if (r.code === 0) {
      committed = true
      log.push(`committed: ${message}`)
    } else {
      log.push(`commit failed: ${r.err || r.out}`)
    }
  } else {
    log.push('nothing to commit (working tree clean)')
  }

  let pushed = false
  let pushError = ''
  if (push) {
    const origin = await git(path, ['remote', 'get-url', 'origin'])
    if (origin.code !== 0) {
      pushError = "no 'origin' remote set -- add one first"
      log.push(pushError)
    } else {
      let delay = 2000
      for (let attempt = 1; attempt <= retries; attempt++) {
        const r = await git(path, ['push', '-u', 'origin', branch], 180_000)
        if (r.code === 0) {
          pushed = true
          log.push(`pushed to origin/${branch}`)
          break
        }
        pushError = r.err || r.out
        const low = pushError.toLowerCase()
        // Auth/permission failures will not fix themselves: do not retry blindly.
        if (
          ['authentication', 'permission', 'denied', 'could not read', 'rejected', 'not found'].some(
            (k) => low.includes(k)
          )
        ) {
          log.push(`push failed (not retrying): ${pushError}`)
          break
        }
        log.push(`push attempt ${attempt} failed: ${pushError}`)
        if (attempt < retries) {
          await new Promise((r2) => setTimeout(r2, delay))
          delay *= 2
        }
      }
    }
  }

  return { ok: committed || pushed || !push, committed, pushed, branch, log, push_error: pushError }
}
