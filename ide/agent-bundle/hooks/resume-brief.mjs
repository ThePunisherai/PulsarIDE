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
 *  - It never writes the board's work. The one thing it changes is where the
 *    project's loose docs sit: they move into docs/ before the agent looks
 *    (tracker/mcp/docs-tidy.mjs), the brief says what moved, and the board's
 *    activity log records it.
 *  - Every failure is swallowed. A SessionStart hook that errors is noise in
 *    front of the user's first prompt, and a tracker problem must never do that.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  const boardFile = join(project, '.planide', 'state.json')
  const state = JSON.parse(readFileSync(boardFile, 'utf8'))

  // Loose docs into docs/ before the session reads anything -- so an existing
  // project is tidied the first time any agent starts in it.
  let docsNote = ''
  try {
    const { sweepDocs, sweepNote } = await import(pathToFileURL(join(here, '..', 'tracker', 'mcp', 'docs-tidy.mjs')).href)
    const moved = sweepDocs(project)
    docsNote = sweepNote(moved)
    if (docsNote) {
      const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      state.activity ??= []
      state.activity.unshift({ id: `a_${randomUUID().replace(/-/g, '').slice(0, 12)}`, at, kind: 'docs', text: `docs: ${moved.length} loose doc(s) moved into docs/`, who: 'auto' })
      if (state.activity.length > 500) state.activity.length = 500
      const tmp = `${boardFile}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      renameSync(tmp, boardFile)
    }
  } catch {
    docsNote = ''
  }

  // Resumed or compacted, this chat keeps its own item ahead of the queue.
  let chatLine = ''
  try {
    const session = typeof payload.session_id === 'string' ? payload.session_id : ''
    if (session) {
      const { readSession } = await import(pathToFileURL(join(here, '..', 'tracker', 'mcp', 'sessions.mjs')).href)
      const { chatItem } = await import(pathToFileURL(join(here, '..', 'tracker', 'mcp', 'work-queue.mjs')).href)
      const own = chatItem(state, readSession(project, session)?.current)
      if (own) chatLine = `This chat was working on "${own.title}" [${own.id}] and it is not finished -- carry on with it first.`
    }
  } catch {
    chatLine = ''
  }

  const brief = [docsNote, chatLine, resumeBrief(state, { project })].filter(Boolean).join('\n')
  if (!brief) return

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief }
    })}\n`
  )
}

// A closed pipe on the agent's side must not turn into a crash and an exit code.
process.stdout.on('error', () => {})
try {
  await main()
} catch (err) {
  // Never put a tracker problem in front of the user's first prompt. The launcher sends
  // stderr to hooks/hook-errors.log, so the cause is kept without being shown.
  process.stderr.write(`[resume-brief] ${new Date().toISOString()} ${err?.stack || err}\n`)
}
