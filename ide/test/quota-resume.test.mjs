#!/usr/bin/env node
/**
 * Auto-resume after a usage limit (src/main/planide/quota-resume.ts).
 *
 * Run by verify.sh against an esbuild bundle of the module (PULSAR_RESUME_CJS).
 * Feeds the watcher what a Codex pane really prints (the message text from
 * codex-rs/protocol error.rs, wrapped in terminal escapes and split across
 * chunks), with a fake clock, fake timers and a fake pty, and checks what gets
 * typed where -- and, more to the point, when nothing must be.
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { QuotaResume, parseQuotaStop, terminalText, RESUME_TEXT, RESUME_GRACE_MS } = await import(process.env.PULSAR_RESUME_CJS)

let pass = 0
let fail = 0
const ok = (n, c) => (c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)))

// A fixed "now": 2026-10-04 14:00 local time.
const NOW = new Date(2026, 9, 4, 14, 0, 0, 0).getTime()
const at = (h, m, dayOffset = 0) => new Date(2026, 9, 4 + dayOffset, h, m, 0, 0).getTime()

// --- reading the stop -------------------------------------------------------- //
ok('text: escapes out, carriage returns become line breaks',
  terminalText('\x1b[1;31mYou’ve hit\x1b[0m your\r\nlimit\x1b]0;title\x07\x1b[3Cnow') === "You've hit your\nlimit now")
const codexToday = "■ You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 3:45 PM."
const p1 = parseQuotaStop(terminalText(codexToday), NOW)
ok('codex: "try again at 3:45 PM" today', p1 && p1.resetAt === at(15, 45) && /usage limit/.test(p1.message))
const p2 = parseQuotaStop("You've hit your usage limit. Try again at Oct 6th, 2026 9:05 AM.", NOW)
ok('codex: another day, "Oct 6th, 2026 9:05 AM"', p2 && p2.resetAt === at(9, 5, 2))
const p3 = parseQuotaStop('Rate limit reached. Please try again in 2h 13m.', NOW)
ok('relative: "try again in 2h 13m"', p3 && p3.resetAt === NOW + (2 * 60 + 13) * 60e3)
const p4 = parseQuotaStop('Quota exceeded for this model. Access resets at 16:30.', NOW)
ok('24-hour clock: "resets at 16:30"', p4 && p4.resetAt === at(16, 30))
ok('a time already past today is an old message redrawn, not a new stop',
  parseQuotaStop("You've hit your usage limit. Try again at 1:15 PM.", NOW) === null)
const late = new Date(2026, 9, 4, 23, 10).getTime()
const p5 = parseQuotaStop('Usage limit reached. Resets at 1:00 AM.', late)
ok('11 pm and "resets at 1:00 AM": that is tomorrow', p5 && p5.resetAt === at(1, 0, 1))
ok('Claude Code continuing by itself is left to it',
  parseQuotaStop('Usage limit reached · continuing automatically at 3:45pm · esc to cancel', NOW) === 'native')
ok('no time given: nothing to schedule', parseQuotaStop("You've hit your usage limit. Try again later.", NOW) === null)
ok('ordinary output is not a stop', parseQuotaStop('Set the rate to 3:45 PM in the limit field', NOW) === null)

// --- the watcher ------------------------------------------------------------- //
function harness(agent = 'codex') {
  let now = NOW
  const timers = []
  const writes = []
  let alive = true
  const runtime = {
    ptyController: { write: (id, data) => (alive ? (writes.push([id, data]), true) : false) },
    getPtyAgent: () => agent
  }
  const w = new QuotaResume({
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, due: now + ms, done: false }
      timers.push(t)
      return t
    },
    clearTimer: (t) => {
      if (t) t.done = true
    },
    submitDelayMs: 700
  })
  const run = (until) => {
    now = until
    for (let again = true; again; ) {
      again = false
      for (const t of timers) {
        if (!t.done && t.due <= now) {
          t.done = true
          t.fn()
          again = true
        }
      }
    }
  }
  return { w, runtime, writes, run, kill: () => (alive = false), setNow: (t) => (now = t) }
}

{
  const h = harness()
  // Split across chunks, wrapped in escapes, the time in the second chunk.
  h.w.ingest('pty-1', '\x1b[2K\x1b[31m■ You’ve hit your usage limit.\x1b[0m Upgrade to Pro', h.runtime)
  h.w.ingest('pty-1', ' (https://chatgpt.com/explore/pro) or try again at\x1b[1m 3:45 PM.\x1b[0m\r\n', h.runtime)
  const st = h.w.status()
  ok('watcher: a stop split over chunks is scheduled for one minute after the reset',
    st.pending.length === 1 && st.pending[0].fireAt === at(15, 45) + RESUME_GRACE_MS && st.pending[0].agent === 'codex')
  h.w.ingest('pty-1', '\x1b[H\x1b[2J■ You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 3:45 PM.\r\n', h.runtime)
  ok('watcher: the same message redrawn is not scheduled twice',
    h.w.status().recent.filter((e) => e.event === 'scheduled').length === 1)
  h.w.noteInput('pty-1', '\x1b[I')
  h.w.noteInput('pty-1', '\x1b]11;rgb:0000/0000/0000\x1b\\')
  ok('watcher: focus reports and terminal replies are not the user', h.w.status().pending.length === 1)
  h.run(at(15, 45) + 30_000)
  ok('watcher: nothing is typed before the reset is a minute past', h.writes.length === 0)
  h.run(at(15, 46))
  h.run(at(15, 46) + 800)
  ok(`watcher: then "${RESUME_TEXT}" is typed into that pane, and Enter on its own after it`,
    h.writes.length === 2 && h.writes[0][0] === 'pty-1' && h.writes[0][1] === RESUME_TEXT && h.writes[1][1] === '\r')
  ok('watcher: and it is on record', h.w.status().recent.some((e) => e.event === 'resumed') && h.w.status().pending.length === 0)
}

{
  const h = harness()
  h.w.ingest('pty-2', "You've hit your usage limit. Try again at 4:00 PM.\n", h.runtime)
  h.w.noteInput('pty-2', 'n')
  ok('watcher: the user typing in that pane calls the resume off',
    h.w.status().pending.length === 0 && h.w.status().recent.some((e) => e.event === 'cancelled'))
  h.run(at(16, 30))
  ok('watcher: and nothing is typed', h.writes.length === 0)
}

{
  const h = harness('claude')
  h.w.ingest('pty-3', 'Claude usage limit reached. Your limit will reset at 5:00 PM.\n', h.runtime)
  ok('watcher: Claude Code panes are left to Claude Code', h.w.status().pending.length === 0)
  const u = harness(null)
  u.w.ingest('pty-4', "cat log: You've hit your usage limit. Try again at 4:00 PM.\n", u.runtime)
  ok('watcher: a pane with no known agent (a shell printing a log) is never typed into', u.w.status().pending.length === 0)
}

{
  const h = harness()
  // Still limited after each resume: a new stop with a new time, three times.
  const stops = [[15, 0], [15, 30], [16, 0], [16, 30]]
  for (const [hh, mm] of stops) {
    h.w.ingest('pty-5', `You've hit your usage limit. Try again at ${hh}:${String(mm).padStart(2, '0')} PM.\n`.replace(/ (\d+):(\d+) PM/, (_, a, b) => ` ${a - 12}:${b} PM`), h.runtime)
    h.run(at(hh, mm) + RESUME_GRACE_MS + 1000)
  }
  ok('watcher: three resumes in a row without the user, then it stops trying',
    h.writes.filter((w) => w[1] === RESUME_TEXT).length === 3 && h.w.status().recent.some((e) => e.event === 'gave-up'))
}

{
  const h = harness()
  h.w.ingest('pty-6', "You've hit your usage limit. Try again at 3:00 PM.\n", h.runtime)
  h.kill()
  h.run(at(15, 2))
  ok('watcher: a pane that closed meanwhile is dropped, not retried',
    h.writes.length === 0 && h.w.status().recent.some((e) => e.event === 'cancelled' && /gone/.test(e.detail)))
}

{
  const userData = mkdtempSync(join(tmpdir(), 'pulsar-resume-'))
  const h = harness()
  h.w.start(userData)
  h.w.ingest('pty-7', "You've hit your usage limit. Try again at 3:00 PM.\n", h.runtime)
  h.w.setEnabled(false)
  h.run(at(15, 5))
  ok('switch: off calls off what was waiting, and it sticks',
    h.writes.length === 0 && h.w.status().pending.length === 0 &&
    JSON.parse(readFileSync(join(userData, 'pulsaride-storage', 'quota-resume.json'), 'utf8')).enabled === false)
  h.w.ingest('pty-7', "You've hit your usage limit. Try again at 4:00 PM.\n", h.runtime)
  ok('switch: while off, nothing is scheduled', h.w.status().pending.length === 0)
  const again = new QuotaResume()
  again.start(userData)
  ok('switch: a new start reads it back', again.status().enabled === false)
  ok('log: what happened is written beside it',
    existsSync(join(userData, 'pulsaride-storage', 'quota-resume.log.jsonl')))
}

{
  const h = harness()
  let threw = false
  try {
    h.w.ingest('pty-8', null, h.runtime)
    h.w.ingest('pty-8', '\x1b[' + 'limit '.repeat(5000), h.runtime)
    h.w.noteInput('pty-8', undefined)
  } catch {
    threw = true
  }
  ok('robust: odd input never throws into the terminal path', threw === false)
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
