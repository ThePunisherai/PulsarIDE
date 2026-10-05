/**
 * Autopilot: an agent that finished what it was doing takes the board's next
 * item, instead of stopping beside a queue nobody asked it to look at.
 *
 * Asked for directly: "als ik niet vraag pak wat in behandeling is op, doet hij
 * het niet -- hij doet alles behalve wat in behandeling of todo zit". The
 * session-start brief named the queue, but only once, and every new prompt
 * took over from there. So this hook answers at the two moments that matter:
 *
 *  - the user's prompt (Claude Code / Codex / Qwen Code `UserPromptSubmit`,
 *    Gemini CLI `BeforeAgent`): it marks where the board stands, and if the
 *    prompt is only "ga door" / "continue", it adds the item to continue with.
 *  - the end of the agent's turn (`Stop`, Gemini CLI `AfterAgent`): if this
 *    turn worked the board and the board moved, the turn is not over -- the
 *    hook blocks the stop with the next item by the work order as the reason.
 *    Claude Code and Codex continue the turn with that reason (verified in
 *    openai/codex codex-rs/hooks/src/events/stop.rs and schema.rs:
 *    `{ decision: "block", reason }`, deny_unknown_fields); Gemini CLI sends
 *    it to the agent as a new prompt (docs/hooks/reference.md, AfterAgent).
 *
 * Two jobs ride along, both about docs (tracker/mcp/docs-tidy.mjs): at every
 * prompt, loose docs an agent left at the root move into docs/ and the agent
 * is told; and when a working turn ends on a clear board, the docs are bundled
 * -- a board item asks for docs/ to become one clear docs/README.md, and the
 * autopilot hands it over like any other ("zodra een project af is alle docs
 * lezen en één duidelijk document maken").
 *
 * What keeps it from looping or hijacking a conversation is in keepGoing
 * (tracker/mcp/work-queue.mjs): the user's switch, progress since the last
 * push, a per-turn limit, a turn that never touched the board, and -- here --
 * a turn that ended on a question to the user. All state lives in
 * `.planide/sessions.json` (tracker/mcp/sessions.mjs), never in the board.
 *
 * Only a project PulsarIDE already tracks, and every failure is swallowed: a
 * hook error at the end of a turn would be noise in front of the user.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
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

function trackedProject(cwd) {
  const raw = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : ''
  if (!raw) return null
  const path = resolve(raw)
  if (path === resolve(homedir())) return null
  return existsSync(join(path, '.planide', 'state.json')) ? path : null
}

/**
 * The agent's last words this turn. Codex hands them over as
 * `last_assistant_message`, Gemini CLI as `prompt_response`; Claude Code only
 * gives the transcript, so its tail is read (JSONL, newest last).
 */
function lastAgentText(payload) {
  for (const k of ['last_assistant_message', 'prompt_response']) {
    if (typeof payload[k] === 'string' && payload[k].trim()) return payload[k]
  }
  const path = typeof payload.transcript_path === 'string' ? payload.transcript_path : ''
  if (!path || !existsSync(path)) return ''
  let fd = null
  try {
    const size = statSync(path).size
    const len = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(len)
    fd = openSync(path, 'r')
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n').reverse()
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue
      try {
        const entry = JSON.parse(line)
        const content = entry?.message?.content
        const text = Array.isArray(content)
          ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n')
          : typeof content === 'string'
            ? content
            : ''
        if (text.trim()) return text
      } catch {
        /* a line cut in half at the window's start */
      }
    }
  } catch {
    return ''
  } finally {
    if (fd !== null) closeSync(fd)
  }
  return ''
}

/** The turn ended on a question to the user: theirs to answer, not ours to push past. */
export function endsOnQuestion(text) {
  const t = String(text ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_`>\s)\]"']+$/g, '')
    .trim()
  return t.endsWith('?')
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const newId = (p) => p + randomUUID().replace(/-/g, '').slice(0, 12)

function saveBoard(project, state) {
  state.updated_at = nowIso()
  const file = join(project, '.planide', 'state.json')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function logActivity(state, kind, text) {
  state.activity ??= []
  state.activity.unshift({ id: newId('a_'), at: nowIso(), kind, text, who: 'auto' })
  if (state.activity.length > 500) state.activity.length = 500
}

/**
 * The bundle item, when the board is clear and docs/ is spread over several
 * documents. Once per set of documents: `bundle_for` remembers which set it was
 * asked for, so an agent that closes it without bundling is not asked again
 * and again for the same files. Returns true when it added the item.
 */
function requestBundle(project, state, docsTidy, wq) {
  const docs = docsTidy.docsNeedBundling(project)
  if (!docs.length) return false
  const key = docs.join('|')
  const items = (state.items ??= [])
  if (items.some((i) => wq.sameTitle(i.title, docsTidy.BUNDLE_TITLE) && (i.status !== 'done' || i.bundle_for === key))) {
    return false
  }
  const at = nowIso()
  items.push({
    id: newId('i_'),
    title: docsTidy.BUNDLE_TITLE,
    status: 'todo',
    notes: docsTidy.bundleNotes(docs),
    tags: ['docs'],
    priority: 'normal',
    created_at: at,
    updated_at: at,
    claimed_by: '',
    verified: false,
    verified_at: '',
    verified_by: '',
    locked: false,
    locked_at: '',
    bundle_for: key
  })
  logActivity(state, 'docs', `board clear: ${docs.length} docs in docs/ to bundle into one`)
  saveBoard(project, state)
  return true
}

/**
 * Which CLI this chat is, from the payload's own shape: Qwen Code keeps its
 * transcript under ~/.qwen, Gemini CLI names the events BeforeAgent/AfterAgent,
 * Codex alone sends a `turn_id`, and the rest is Claude Code.
 */
function chatFamily(payload) {
  // Qwen Code uses Claude Code's event names, so its transcript tells it apart.
  if (/[\\/]\.qwen[\\/]/.test(String(payload.transcript_path || ''))) return 'qwen'
  const event = String(payload.hook_event_name || '')
  if (event === 'BeforeAgent' || event === 'AfterAgent') return 'gemini'
  return typeof payload.turn_id === 'string' ? 'codex' : 'claude'
}

const PROMPT_EVENTS = new Set(['UserPromptSubmit', 'BeforeAgent'])
const STOP_EVENTS = new Set(['Stop', 'AfterAgent'])

async function main() {
  const raw = readStdin()
  if (!raw.trim()) return
  const payload = JSON.parse(raw)
  const event = String(payload.hook_event_name || '')
  if (!PROMPT_EVENTS.has(event) && !STOP_EVENTS.has(event)) return
  const session = String(payload.session_id || '')
  if (!session) return
  const project = trackedProject(payload.cwd || process.cwd())
  if (!project) return

  const here = dirname(fileURLToPath(import.meta.url))
  const mcp = join(here, '..', 'tracker', 'mcp')
  const wq = await import(pathToFileURL(join(mcp, 'work-queue.mjs')).href)
  const ss = await import(pathToFileURL(join(mcp, 'sessions.mjs')).href)
  const docsTidy = await import(pathToFileURL(join(mcp, 'docs-tidy.mjs')).href)
  const siblingGuard = await import(pathToFileURL(join(mcp, 'sibling-guard.mjs')).href)
  const state = JSON.parse(readFileSync(join(project, '.planide', 'state.json'), 'utf8'))

  if (PROMPT_EVENTS.has(event)) {
    // Loose docs the last turn left at the root go into docs/, and the agent
    // hears where -- it may still think they are at the root.
    let docsNote = ''
    try {
      const moved = docsTidy.sweepDocs(project)
      docsNote = docsTidy.sweepNote(moved)
      if (docsNote) {
        logActivity(state, 'docs', `docs: ${moved.length} loose doc(s) moved into docs/`)
        saveBoard(project, state)
      }
    } catch {
      docsNote = ''
    }
    const drive = wq.isContinuePrompt(payload.prompt)
    // This chat's own item: what it took up last turn, even when that turn
    // never reached its Stop because the quota ran out in the middle of it.
    const prev = ss.readSession(project, session)
    const own = wq.newlyWip(state, prev?.wip, chatFamily(payload))[0] ?? prev?.current ?? ''
    // "ga door" in a chat with no item of its own -- a new chat, another CLI --
    // hands it the item the work stopped on, and that item is this chat's from
    // here: its plan for it becomes the item's checklist, the way the autopilot's
    // hand-over does. Without this the new chat's plan landed as rows beside it.
    const handed = drive && wq.autopilot(state) ? wq.continueFocus(state, { current: own }) : null
    const current = handed?.id ?? own
    // A new turn: where the board stands now is what progress is measured from.
    ss.updateSession(project, session, () => ({
      mark: wq.boardMark(state),
      worked: false,
      drive,
      pushes: 0,
      current,
      wip: wq.wipIds(state),
      // The user asked for a copy, worktree or new folder in this chat: from
      // then on project-guard lets this chat make one (sibling-guard.mjs).
      asked_copy: Boolean(prev?.asked_copy) || siblingGuard.asksForCopy(payload.prompt)
    }))
    // Worded from the chat's own item, not the one just handed over: a new chat
    // has no plan for it in its conversation, so it is told the checklist.
    const context = [docsNote, drive && wq.autopilot(state) ? wq.continueContext(state, { current: own }) : '']
      .filter(Boolean)
      .join('\n')
    if (!context) return
    process.stdout.write(
      `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } })}\n`
    )
    return
  }

  const seen = ss.readSession(project, session)
  if (!seen) return
  // What this chat took up during the turn -- through its plan, next_task or
  // set_item -- is its own item from here on: "ga door" in this chat means it.
  const picked = wq.newlyWip(state, seen.wip, chatFamily(payload))
  // Taking an item up through the board's own tools (next_task claim, set_item
  // wip) without a plan is working the board too: such a turn used to stop
  // with the item it had just taken still in progress, and nothing picked it
  // up again. Only this chat's own pick counts -- another pane moving the
  // board is no reason to put board work after an answered question.
  const rec = picked.length ? { ...seen, current: picked[0], wip: wq.wipIds(state), worked: true } : seen
  if (picked.length) ss.updateSession(project, session, () => rec)
  if (endsOnQuestion(lastAgentText(payload))) return
  let decision = wq.keepGoing(state, rec)
  // A working turn ended on a clear board: the last job is the docs, as one.
  const working = rec.worked || rec.drive || (rec.pushes ?? 0) > 0
  if (!decision.block && decision.why === 'nothing open' && working && wq.autopilot(state)) {
    if (requestBundle(project, state, docsTidy, wq)) decision = wq.keepGoing(state, { ...rec, mark: '' })
  }
  if (!decision.block) return
  // The bundle's instructions live in its notes; the agent gets them with it.
  let reason = decision.reason
  if (wq.sameTitle(decision.focus?.title, docsTidy.BUNDLE_TITLE)) {
    const item = (state.items ?? []).find((i) => i.id === decision.focus.id)
    if (item?.notes) reason += ` ${item.notes}`
  }
  ss.updateSession(project, session, (r) => ({
    ...(r ?? rec),
    mark: decision.mark,
    pushes: (r?.pushes ?? 0) + 1,
    // The item handed over is this chat's now, even before it is started.
    current: decision.focus?.kind === 'item' ? decision.focus.id : (r ?? rec).current,
    wip: wq.wipIds(state)
  }))
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
}

// Run as a hook, not when a test imports endsOnQuestion. Windows paths compare
// case-insensitively: the launcher's drive letter need not match node's.
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  // A closed pipe on the agent's side must not turn into a crash and an exit code.
  process.stdout.on('error', () => {})
  try {
    await main()
  } catch (err) {
    // Never put a tracker problem between the agent and the end of its turn.
    // The launcher sends stderr to hooks/hook-errors.log, so the cause is kept.
    process.stderr.write(`[keep-going] ${new Date().toISOString()} ${err?.stack || err}\n`)
  }
}
