/**
 * The board's work order, and the one title match every writer shares.
 *
 * Asked for directly: "als iets in tracker in behandeling staat moet afgerond
 * worden daarna verder met todo, en nieuwe bugs moeten bij fixes onder open en
 * later opgepakt worden". So the order is fixed, not left to whichever agent
 * reads the board:
 *
 *   1. in progress (`wip`)  -- finish what was started, including what a
 *                              previous session left half done
 *   2. todo                 -- in priority order, then oldest first
 *   3. open fixes           -- the bugs found along the way, which waited their
 *                              turn in Fixes > Open instead of derailing step 1
 *   4. broken items         -- after the logged fixes
 *
 * `blocked` is never picked: it waits on someone, and an agent working around
 * a block is how a board gets green-washed. A regression (protected work that
 * broke) is not reordered either -- it is surfaced as an alert on top, so the
 * user decides, instead of an agent silently changing the order they set.
 *
 * Shared, not copied: the planide MCP server, the todo-sync hook and the
 * resume-brief hook all import this file. Two private copies of "is this the
 * same step" is exactly how the hook and sync_plan drifted apart -- the hook
 * kept punctuation, the server did not, and "Write tests." / "Write tests"
 * became two rows. Plain JS, no imports, so it loads wherever those do.
 */

/** A `wip` item untouched this long was left behind by an earlier session. */
export const STALE_HOURS = 12

/** How many entries per lane a caller gets by default. Counts stay complete. */
const DEFAULT_LIMIT = 5

/** Free-text priority, ranked. Anything unrecognised ranks as normal. */
const PRIORITY_RANK = {
  urgent: 0, critical: 0, p0: 0, blocker: 0,
  high: 1, p1: 1,
  normal: 2, medium: 2, p2: 2, '': 2,
  low: 3, p3: 3, someday: 3
}

/**
 * A title reduced to what makes it the same piece of work: case, spacing and
 * punctuation ignored.
 *
 * Unicode-aware on purpose. The old `[^a-z0-9]` version erased every letter
 * outside ASCII, so a Cyrillic, Greek, CJK or Arabic title normalised to the
 * empty string -- and every such title then "matched" every other one. Adding
 * "Добавить поиск" returned "Исправить вход" as the existing item, and the new
 * work never reached the board. Accented Latin lost letters the same way.
 */
export function normTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Two titles name the same work. An empty key never matches anything. */
export function sameTitle(a, b) {
  const ka = normTitle(a)
  return ka !== '' && ka === normTitle(b)
}

const lc = (v) => String(v ?? '').trim().toLowerCase()

/**
 * Where one step of an agent's plan lands on the board.
 *
 *   { action: 'add' }          -- a new row
 *   { action: 'move', item }   -- this row, to the plan's state
 *   { action: 'keep', item }   -- this row, untouched
 *
 * Three rules the plan hook and sync_plan used to get wrong, each of which
 * undid something a person had done:
 *
 *  - A finished item stays finished. Agents re-send their WHOLE plan on every
 *    change, finished steps included, and the plan's "completed" maps to
 *    `works`. So an item closed out to `done` -- which the agent instructions
 *    ask for -- was dropped back to `works` on the very next plan update, and
 *    because that is a status change it also wiped the user's confirmation.
 *  - An open row wins over a closed one. Work recurs ("run the tests"); when
 *    the only match is already `done` and the plan starts it again, that is a
 *    new row -- the same rule add_item follows -- not the closed one reopened.
 *  - A protected item is the user's, and a plan never moves it.
 */
export function planStep(items, title, status) {
  const key = normTitle(title)
  if (!key) return { action: 'add' }
  const same = (items ?? []).filter((i) => normTitle(i.title) === key)
  if (!same.length) return { action: 'add' }
  const item = same.find((i) => i.status !== 'done') ?? same[0]
  if (item.locked) return { action: 'keep', item }
  if (item.status === 'done') {
    return status === 'works' || status === 'done' ? { action: 'keep', item } : { action: 'add' }
  }
  if (item.status === status) return { action: 'keep', item }
  return { action: 'move', item }
}

/**
 * The user's switch: work that works counts as finished, with no one ticking
 * it off by hand. Asked for directly: "wat werkt mag als afgerond zijn, want
 * ik ga niet handmatig dat doen". On unless the user turned it off -- a board
 * written before the switch existed has no `settings` and reads as on.
 *
 * It is a SETTING, not a flag on the work: only the user changes it (the IDE,
 * or `plan settings`), and no agent-facing tool can. What it changes is how an
 * agent's report lands and how the rollups read it -- never `locked`, and
 * never the "confirmed by you" count, which stays the user's own checks.
 */
export function autoComplete(state) {
  return state?.settings?.auto_complete !== false
}

/** Where an agent's "it works" lands: `done` with auto-complete on, else as said. */
export function finishedStatus(state, status) {
  return status === 'works' && autoComplete(state) ? 'done' : status
}

/**
 * Close out what an agent reported working: `works` -> `done`.
 *
 * The other half of finishedStatus, for everything already sitting in `works`
 * -- written before the switch, or by a route that does not map (an older
 * plan hook, the Python CLI, a hand-edited board). Only items an agent
 * reported (claimed_by set): a `works` you chose yourself stays yours. Never
 * a protected item, which a plan never moves either. A confirmation is kept,
 * not dropped -- `works` and `done` both say it works, so what was confirmed
 * is still what the item says. Returns the items it closed; logging is the
 * caller's, so each writer attributes it in its own activity format.
 */
export function closeOutWorking(state, stamp) {
  if (!autoComplete(state)) return []
  const at = stamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const closed = []
  for (const item of state?.items ?? []) {
    if (item.status !== 'works' || item.locked || !String(item.claimed_by || '').trim()) continue
    item.status = 'done'
    item.updated_at = at
    closed.push(item)
  }
  return closed
}

/** The open fix already logged under this title, if there is one. */
export function findOpenFix(fixes, title) {
  return (fixes ?? []).find((f) => f.status === 'open' && sameTitle(f.title, title)) ?? null
}

/** Other `wip` items the same agent already holds -- the "finish that first" check. */
export function wipHeldBy(items, agent, exceptId = '') {
  const me = lc(agent)
  if (!me) return []
  return (items ?? []).filter((i) => i.status === 'wip' && i.id !== exceptId && lc(i.claimed_by) === me)
}

function ageMs(iso, now) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? Math.max(0, now - t) : Number.POSITIVE_INFINITY
}

function idle(ms) {
  if (!Number.isFinite(ms)) return 'unknown'
  const h = ms / 3600e3
  if (h < 1) return `${Math.max(1, Math.round(ms / 60e3))}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function itemCard(i, now) {
  return {
    kind: 'item',
    id: i.id,
    title: i.title,
    status: i.status,
    claimed_by: i.claimed_by || '',
    idle: idle(ageMs(i.updated_at, now)),
    ...(i.locked ? { locked: true } : {})
  }
}

function fixCard(f) {
  return {
    kind: 'fix',
    id: f.id,
    title: f.title,
    problem: clip(f.problem, 240),
    logged_by: f.agent || '',
    created_at: f.created_at || ''
  }
}

const ACTION = {
  in_progress:
    'Finish this first. set_item it to works/done in the same turn it genuinely works, then call next_task again.',
  todo: 'Start this: next_task with claim=true (or set_item wip), do it, then set_item works/done.',
  fix: 'Fix this, verify it, then mark_fixed with the real solution -- what caused it and what changed.',
  broken: 'Make this work again, then set_item works. Log what caused it with add_fix if it was not logged yet.'
}

export const WORK_ORDER =
  'Finish in_progress first, then todo in order, then open fixes, then broken items. ' +
  'A bug you hit mid-task goes on the board with add_fix (Fixes > Open) and waits its turn -- log it, do not switch to it. ' +
  'blocked waits on someone and is never picked.'

/**
 * The queue, in order, plus the one thing to do now.
 *
 * `agent` makes it safe with parallel agents: an in-progress item another
 * agent touched recently is theirs and is listed under `elsewhere`, not handed
 * out twice. Once it has sat for STALE_HOURS nobody is on it any more, and it
 * comes back into the queue as unfinished work for whoever resumes. Without
 * `agent`, every in-progress item is yours to finish.
 */
export function workQueue(state, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT
  const me = lc(opts.agent)
  const staleMs = STALE_HOURS * 3600e3
  const items = state?.items ?? []
  const fixes = state?.fixes ?? []

  const wipAll = items
    .filter((i) => i.status === 'wip')
    .map((i) => ({
      i,
      age: ageMs(i.updated_at, now),
      mine: Boolean(me) && lc(i.claimed_by) === me
    }))
  const isMineToFinish = (w) => !me || w.mine || !w.i.claimed_by || w.age >= staleMs
  const wip = wipAll
    .filter(isMineToFinish)
    // Your own first, then whatever has waited longest.
    .sort((a, b) => Number(b.mine) - Number(a.mine) || b.age - a.age)
    .map((w) => ({ ...itemCard(w.i, now), ...(w.age >= staleMs ? { stale: true } : {}) }))
  const elsewhere = wipAll.filter((w) => !isMineToFinish(w)).map((w) => itemCard(w.i, now))

  const rank = (p) => PRIORITY_RANK[lc(p)] ?? PRIORITY_RANK.normal
  const todo = items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => i.status === 'todo')
    .sort(
      (a, b) =>
        rank(a.i.priority) - rank(b.i.priority) ||
        String(a.i.created_at || '').localeCompare(String(b.i.created_at || '')) ||
        a.idx - b.idx
    )
    .map(({ i }) => ({ ...itemCard(i, now), ...(rank(i.priority) < 2 ? { priority: i.priority } : {}) }))

  // Open is anything not closed: a fix with no status at all was logged by an
  // IDE whose addFix dropped the default, and it was meant to be open.
  const openFixes = fixes
    .map((f, idx) => ({ f, idx }))
    .filter(({ f }) => f.status !== 'fixed' && f.status !== 'wontfix')
    .sort((a, b) => String(a.f.created_at || '').localeCompare(String(b.f.created_at || '')) || a.idx - b.idx)
    .map(({ f }) => fixCard(f))

  // Regressions first within their lane; they are the loud ones.
  const broken = items
    .filter((i) => i.status === 'broken')
    .sort((a, b) => Number(Boolean(b.locked)) - Number(Boolean(a.locked)))
    .map((i) => itemCard(i, now))
  const blocked = items.filter((i) => i.status === 'blocked').map((i) => itemCard(i, now))
  const regressions = items
    .filter((i) => i.locked && (i.status === 'broken' || i.status === 'blocked'))
    .map((i) => itemCard(i, now))

  let focus = null
  let phase = 'clear'
  if (wip.length) {
    focus = { lane: 'in_progress', ...wip[0], action: ACTION.in_progress }
    phase = 'finish'
  } else if (todo.length) {
    focus = { lane: 'todo', ...todo[0], action: ACTION.todo }
    phase = 'todo'
  } else if (openFixes.length) {
    focus = { lane: 'fix', ...openFixes[0], action: ACTION.fix }
    phase = 'fixes'
  } else if (broken.length) {
    focus = { lane: 'broken', ...broken[0], action: ACTION.broken }
    phase = 'fixes'
  }

  return {
    phase,
    focus,
    alerts: regressions.map((r) => `REGRESSION: protected "${r.title}" [${r.id}] is ${r.status} -- tell the user before anything else.`),
    counts: {
      in_progress: wip.length,
      elsewhere: elsewhere.length,
      todo: todo.length,
      open_fixes: openFixes.length,
      broken: broken.length,
      blocked: blocked.length
    },
    in_progress: wip.slice(0, limit),
    todo: todo.slice(0, limit),
    open_fixes: openFixes.slice(0, limit),
    broken: broken.slice(0, limit),
    blocked: blocked.slice(0, limit),
    elsewhere: elsewhere.slice(0, limit),
    order: WORK_ORDER
  }
}

/**
 * The same queue as a few lines of text, for a session that is just starting
 * or resuming. Empty when nothing is open: a clean board needs no briefing,
 * and every line here is paid for in the session's context.
 */
export function resumeBrief(state, opts = {}) {
  const q = workQueue(state, { ...opts, limit: 3 })
  const c = q.counts
  if (!q.focus && !q.alerts.length && !c.elsewhere && !c.blocked) return ''
  const project = opts.project || state?.path || ''
  const tag = (x) => `"${clip(x.title, 90)}" [${x.id}]`
  const more = (shown, total) => (total > shown ? ` (+${total - shown} more)` : '')
  const lines = [
    `PulsarIDE board -- where to resume${project ? ` (project: ${project})` : ''}.`,
    `Work order: ${WORK_ORDER}`,
    'What the user asks for now still comes first: put a new request on the board as todo, and if something is still in progress, say so in one line and finish it first unless the user says the new request goes first.'
  ]
  for (const a of q.alerts) lines.push(a)
  if (q.in_progress.length) {
    const list = q.in_progress
      .map((x) => `${tag(x)}${x.stale ? ` (left over, idle ${x.idle})` : ''}${x.claimed_by ? ` by ${x.claimed_by}` : ''}`)
      .join('; ')
    lines.push(`In progress -- finish first: ${list}${more(q.in_progress.length, c.in_progress)}`)
  }
  if (q.todo.length) {
    lines.push(`Next todo: ${q.todo.map((x, n) => `${n + 1}. ${tag(x)}`).join('; ')}${more(q.todo.length, c.todo)}`)
  }
  if (q.open_fixes.length) {
    lines.push(`Open fixes, after the todo list: ${q.open_fixes.map(tag).join('; ')}${more(q.open_fixes.length, c.open_fixes)}`)
  }
  if (q.broken.length) {
    lines.push(`Broken, after the fixes: ${q.broken.map(tag).join('; ')}${more(q.broken.length, c.broken)}`)
  }
  if (q.elsewhere.length) {
    lines.push(`Another agent is on (leave these): ${q.elsewhere.map((x) => `${tag(x)} by ${x.claimed_by}`).join('; ')}`)
  }
  if (c.blocked) lines.push(`Blocked, waiting on someone (never picked automatically): ${c.blocked}`)
  lines.push(
    'The live queue is one call away: next_task(project) -- claim=true starts the next todo for you. ' +
      'When a piece is finished, set_item it works/done in the same turn, then take the next one.'
  )
  return lines.join('\n')
}
