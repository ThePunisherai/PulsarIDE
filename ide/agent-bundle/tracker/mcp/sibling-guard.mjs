/**
 * A project stays one folder. Agents do not make copies of it next to it.
 *
 * "Nou maakt die allemaal mappen aan in plaats van projectmanagement binnen
 * zijn eigen project te blijven -- niemand vraagt om dit": Projectmanagement-
 * v060-dev, -v062-dev ... -v077-dev, one every hour, beside the project. An
 * agent working the board on its own (the autopilot keeps it going) took each
 * "version" as a reason for a fresh worktree or copy of the whole project.
 *
 * So a command or a file write that would create or fill a folder NEXT TO a
 * tracked project, named after it (`<project>-<anything>`), or add a git
 * worktree outside it, is refused with the reason -- unless the user's own
 * prompt in this chat asked for a copy, a worktree, a clone or a new folder.
 * A version is a line on the board (`add_version`), not a folder.
 *
 * Pure functions; the hook (hooks/project-guard.mjs) does the I/O.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)

/** The tracked project a path is in: the nearest folder up with .planide/state.json. */
export function projectRootOf(start) {
  if (!start) return ''
  const home = fold(resolve(homedir()))
  let dir = resolve(start)
  for (let i = 0; i < 12; i++) {
    if (fold(dir) === home) return ''
    if (existsSync(join(dir, '.planide', 'state.json'))) return dir
    const up = dirname(dir)
    if (up === dir) return ''
    dir = up
  }
  return ''
}

/** Did the user ask for a copy, a worktree, a clone or a new folder in this prompt? */
export function asksForCopy(prompt) {
  const t = String(prompt ?? '').toLowerCase()
  if (!t.trim()) return false
  return /\bworktrees?\b|\bkopie\b|\bkopieer|\bkopi[eë]ren\b|\bcopy\b|\bcopies\b|\bdupliceer|\bduplicate\b|\bclone\b|\bkloon\b|\bkloon\w*|nieuwe map|nieuw project|aparte map|aparte kopie|new folder|new project|separate folder|separate copy/.test(
    t
  )
}

/** A command line split into words, honouring double and single quotes. */
function words(command) {
  const out = []
  let word = ''
  let quote = ''
  let started = false
  for (const ch of String(command)) {
    if (quote) {
      if (ch === quote) quote = ''
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/[\s;|&()]/.test(ch)) {
      if (started || word) out.push(word)
      word = ''
      started = false
    } else {
      word += ch
    }
  }
  if (started || word) out.push(word)
  return out
}

/**
 * Where a path lands relative to the project: `sibling` for a folder beside it
 * named after it (or anything inside one), `outside` for anywhere else not in
 * the project, `inside` for the project itself.
 */
export function placeOf(path, root, cwd = root) {
  if (!path || !root) return 'inside'
  // A Windows spelling (..\\copy) read on a POSIX host still names a folder.
  const given = process.platform === 'win32' ? String(path) : String(path).replace(/\\/g, '/')
  const raw = given.replace(/^~(?=[\\/]|$)/, homedir())
  const abs = resolve(isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : join(cwd, raw))
  const r = fold(resolve(root))
  const a = fold(abs)
  const sep = r.includes('\\') ? '\\' : '/'
  if (a === r || a.startsWith(r.endsWith(sep) ? r : r + sep)) return 'inside'
  const parent = fold(dirname(resolve(root)))
  const name = fold(basename(resolve(root)))
  // The first folder below the project's parent on the way to this path.
  let top = ''
  if (a.startsWith(parent.endsWith(sep) ? parent : parent + sep)) {
    top = a.slice(parent.length).replace(/^[\\/]+/, '').split(/[\\/]/)[0] ?? ''
  }
  if (top && top !== name && /^[-_ .]/.test(top.slice(name.length)) && top.startsWith(name)) return 'sibling'
  return 'outside'
}

/** Verbs that make a folder or fill one, in sh, cmd and PowerShell. */
const CREATING = /^(cp|rsync|robocopy|xcopy|copy|copy-item|cpi|mkdir|md|new-item|ni|mv|move|move-item|mi|tar|unzip|expand-archive|clone)$/i

/**
 * The path in a shell command that would put a copy of the project next to it,
 * or a git worktree outside it; null when there is none.
 */
export function siblingInCommand(command, root, cwd = root) {
  const w = words(command)
  if (!w.length) return null
  const lower = w.map((x) => x.toLowerCase())
  // git worktree add <path>: anywhere outside the project is a second checkout.
  for (let i = 0; i + 2 < lower.length; i++) {
    if (lower[i].endsWith('git') || lower[i] === 'git.exe') {
      if (lower[i + 1] === 'worktree' && lower[i + 2] === 'add') {
        const target = w.slice(i + 3).find((x) => !x.startsWith('-'))
        if (target && placeOf(target, root, cwd) !== 'inside') return target
      }
      if (lower[i + 1] === 'clone') {
        const rest = w.slice(i + 2).filter((x) => !x.startsWith('-'))
        const target = rest[1]
        if (target && placeOf(target, root, cwd) === 'sibling') return target
      }
    }
  }
  if (!lower.some((x) => CREATING.test(basename(x).replace(/\.exe$/i, '')))) return null
  for (const x of w) {
    if (!/[\\/]/.test(x) && !x.startsWith('..')) continue
    if (placeOf(x, root, cwd) === 'sibling') return x
  }
  return null
}

/** Paths an apply_patch body adds, updates, deletes or moves to. */
export function patchPaths(patch) {
  const out = []
  for (const m of String(patch ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) {
    out.push((m[1] ?? m[2]).trim())
  }
  return out
}

/** Which path in this tool call lands in a copy of the project beside it; null if none. */
export function siblingInToolCall(toolName, toolInput, root, cwd = root) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : { command: String(toolInput ?? '') }
  const name = String(toolName ?? '')
  if (/^(apply_patch)$/i.test(name) || (typeof input.command === 'string' && /^\*\*\* Begin Patch/m.test(input.command))) {
    return patchPaths(input.command ?? input.patch ?? input.input).find((p) => placeOf(p, root, cwd) === 'sibling') ?? null
  }
  const file = input.file_path ?? input.path ?? input.absolute_path ?? input.filePath
  if (typeof file === 'string' && file) return placeOf(file, root, cwd) === 'sibling' ? file : null
  const command = Array.isArray(input.command) ? input.command.join(' ') : input.command ?? input.cmd
  if (typeof command === 'string' && command) return siblingInCommand(command, root, cwd)
  return null
}

/** What the agent is told instead. */
export function siblingReason(target, root) {
  return (
    `PulsarIDE keeps a project in one folder: "${target}" would put a copy, worktree or version folder ` +
    `next to ${basename(root)}, and the user did not ask for that. Keep working in ${root}. ` +
    'A new version is a line on the board (add_version), not a new folder. If the user wants a ' +
    'separate copy or worktree, they will say so -- then it is allowed in that chat.'
  )
}
