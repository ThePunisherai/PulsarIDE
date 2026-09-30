/**
 * Where to pick up, handed to a session the moment it starts or resumes.
 *
 * The board already knew what was half done -- `wip` items a previous session
 * left behind -- but nothing told the next session. It started from the
 * user's new message, added its own plan beside the unfinished one, and the
 * old `wip` rows sat there for good. Asked for directly: "als iets in tracker
 * in behandeling staat moet afgerond worden daarna verder met todo".
 *
 * Wired as a Claude Code `SessionStart` hook, which fires on startup, resume,
 * clear and compact, runs before the model sees the prompt, and injects
 * `hookSpecificOutput.additionalContext` into the model's context (verified
 * against code.claude.com/docs/en/hooks.md, the same contract the graphify
 * bootstrap relies on). So "continue" after a restart, a /clear or a context
 * compaction lands on the same queue instead of on a blank slate.
 *
 * The brief itself comes from tracker/mcp/work-queue.mjs -- the same code
 * next_task runs -- so the hook and the tool can never disagree on the order.
 *
 * Deliberately quiet:
 *  - Only a project PulsarIDE already tracks (`.planide/state.json` exists).
 *    A session in any other repo gets nothing, and no board is created.
 *  - Nothing when nothing is open: a clean board needs no briefing, and every
 *    line here is paid for in context.
 *  - Read-only. It never writes the board.
 *  - Every failure is swallowed. A SessionStart hook that errors is noise in
 *    front of the user's first prompt, and a tracker problem must never do that.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/** The session's project -- never the home directory, never an untracked one. */
function trackedProject(cwd) {
  const raw = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : ''
  if (!raw) return null
  const path = resolve(raw)
  if (path === resolve(homedir())) return null
  return existsSync(join(path, '.planide', 'state.json')) ? path : null
}

async function main() {
  const raw = readStdin()
  let payload = {}
  try {
    payload = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    payload = {}
  }
  const project = trackedProject(payload.cwd || process.cwd())
  if (!project) return

  const here = dirname(fileURLToPath(import.meta.url))
  const { resumeBrief } = await import(
    pathToFileURL(join(here, '..', 'tracker', 'mcp', 'work-queue.mjs')).href
  )
  const state = JSON.parse(readFileSync(join(project, '.planide', 'state.json'), 'utf8'))
  const brief = resumeBrief(state, { project })
  if (!brief) return

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief }
    })}\n`
  )
}

try {
  await main()
} catch {
  // Never put a tracker problem in front of the user's first prompt.
}
