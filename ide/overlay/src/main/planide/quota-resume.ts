/**
 * Auto-resume: "ga door" typed into a pane the moment its usage limit resets.
 *
 * "Soms raakt mijn quota op, moet ik wachten, dus ga ik altijd door in de
 * huidige chat" -- and then sit there until the reset to type it. Claude Code
 * does this itself now (autoContinueAtUsageLimit, on by default, its own
 * "continuing automatically at 3:45pm"); Codex, Gemini CLI, Qwen Code and the
 * rest just stop. So PulsarIDE watches each agent pane's output for the stop:
 *
 *   Codex (codex-rs/protocol error.rs UsageLimitReachedError):
 *     "You've hit your usage limit. ... try again at 3:45 PM."
 *     "... Try again at Oct 5th, 2026 3:45 PM."       (another day)
 *   and the usual "try again in 2h 13m" / "resets at 15:45" phrasings.
 *
 * One minute after the reset it types `ga door` and Enter into that pane --
 * the same words the user would, which the keep-going hook answers with the
 * chat's own wip/todo item. Never when:
 *  - the user typed anything into that pane in the meantime (they took over);
 *  - the pane is Claude Code (it continues itself; turning that off is a choice),
 *    or a pane with no known agent (a shell printing a log is not a stopped agent);
 *  - the stop gave no time, or a time already past (an old message redrawn);
 *  - the same message was already handled (a redraw of the screen);
 *  - it already resumed that pane three times in a row without the user
 *    touching it (still limited: stop trying, it is the user's call);
 *  - the user turned it off (Toolkit → Auto-resume).
 * Never throws into the terminal data path.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** What this needs from Orca's runtime: write to a pty, and which agent runs in it. */
export type QuotaResumeRuntime = {
  ptyController?: { write(ptyId: string, data: string): boolean } | null
  getPtyAgent?: (ptyId: string) => string | null
}

export type QuotaStop = { resetAt: number; message: string }

export type PendingResume = {
  ptyId: string
  agent: string
  detectedAt: number
  resetAt: number
  fireAt: number
  message: string
}

export type QuotaResumeEvent = {
  at: string
  ptyId: string
  agent: string
  event: 'scheduled' | 'resumed' | 'cancelled' | 'gave-up' | 'skipped'
  detail: string
}

export type QuotaResumeStatus = {
  enabled: boolean
  pending: PendingResume[]
  recent: QuotaResumeEvent[]
}

/** What the agent says when it stops for a usage limit. */
const STOP = /(hit your usage limit|usage limit (?:reached|hit|exceeded)|reached your usage limit|quota (?:exceeded|exhausted)|exhausted your (?:daily |weekly )?quota|rate limit (?:reached|exceeded)|limit reached)/gi
/** Claude Code waiting to continue by itself. */
const NATIVE = /continuing automatically|continue automatically at/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** Typed one minute after the reset: the provider's clock and ours differ a little. */
export const RESUME_GRACE_MS = 60_000
/** Resumes in a row, with no user input in between, before it stops trying. */
export const MAX_TRIES = 3
/** The words typed: what the user types themselves, which the keep-going hook answers. */
export const RESUME_TEXT = 'ga door'
/** Agents that continue by themselves, or are never ours to type into. */
const SKIP_AGENTS = new Set(['claude', 'claude-agent-teams', 'openclaude'])
const MAX_AHEAD_MS = 8 * 24 * 3600_000
const BUFFER_CHARS = 2400
const HANDLED_TTL_MS = 12 * 3600_000

/** Terminal output as text: escape sequences out, carriage returns as line breaks. */
export function terminalText(data: string): string {
  return data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC
    .replace(/\x1b\[[0-9;:]*m/g, '') // colours and styles
    .replace(/\x1b\[[0-9;?<>=!]*[ -/]*[@-~]/g, ' ') // other CSI: cursor moves stand for a gap
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '') // DCS/SOS/PM/APC
    .replace(/\x1b[()*+][0-9A-Za-z]|\x1b[=>78DEHMNOZc]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/’/g, "'")
}

function clock(h: number, m: number, ampm: string | undefined): { h: number; m: number } | null {
  let hour = h
  if (ampm) {
    const pm = /^p/i.test(ampm)
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (pm ? 12 : 0)
  } else if (hour > 23) {
    return null
  }
  if (m > 59) return null
  return { h: hour, m }
}

/**
 * The usage-limit stop in this text, with when it resets; null when there is
 * none, `native` when the agent continues by itself, or no time could be read.
 */
export function parseQuotaStop(text: string, now: number = Date.now()): QuotaStop | 'native' | null {
  // The latest stop on screen: an older one above it was handled already.
  let start = -1
  for (const m of text.matchAll(STOP)) start = m.index ?? start
  if (start < 0) return null
  const tail = text.slice(start, start + 400)
  if (NATIVE.test(tail)) return 'native'
  const said = (end: number): string => tail.slice(0, end).replace(/\s+/g, ' ').trim().slice(0, 240)
  const lead = '(?:try again|retry|resets?|reset|available again|access resets|refreshes)'

  // "try again at Oct 5th, 2026 3:45 PM" -- another day, in local time.
  const dated = new RegExp(
    `${lead}\\s+(?:at|on)\\s+([A-Za-z]{3})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?,?\\s+(?:at\\s+)?(\\d{1,2}):(\\d{2})\\s*([ap]\\.?m\\.?)?`,
    'i'
  ).exec(tail)
  if (dated) {
    const month = MONTHS.indexOf(dated[1].toLowerCase())
    const t = clock(Number(dated[4]), Number(dated[5]), dated[6])
    if (month >= 0 && t) {
      const year = dated[3] ? Number(dated[3]) : new Date(now).getFullYear()
      const at = new Date(year, month, Number(dated[2]), t.h, t.m, 0, 0).getTime()
      return at > now - 60_000 ? { resetAt: at, message: said(dated.index + dated[0].length) } : null
    }
  }

  // "try again in 2h 13m", "retry in 35s", "resets in 3 hours 20 minutes".
  const rel = new RegExp(
    `${lead}\\s+in\\s+((?:\\d+(?:\\.\\d+)?\\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\\b[\\s,]*(?:and\\s+)?)+)`,
    'i'
  ).exec(tail)
  if (rel) {
    let ms = 0
    for (const part of rel[1].matchAll(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
      const n = Number(part[1])
      const unit = part[2].toLowerCase()
      ms += n * (unit.startsWith('d') ? 86400e3 : unit.startsWith('h') ? 3600e3 : unit.startsWith('m') ? 60e3 : 1e3)
    }
    if (ms > 0) return { resetAt: now + ms, message: said(rel.index + rel[0].length) }
  }

  // "try again at 3:45 PM", "resets at 15:45", "resets 3pm": today, local.
  const timeOnly = new RegExp(`${lead}\\s+(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*([ap]\\.?m\\.?)?(?![\\d:])`, 'i').exec(tail)
  if (timeOnly && (timeOnly[2] !== undefined || timeOnly[3] !== undefined)) {
    const t = clock(Number(timeOnly[1]), Number(timeOnly[2] ?? 0), timeOnly[3])
    if (t) {
      const today = new Date(now)
      let at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), t.h, t.m, 0, 0).getTime()
      // Past by more than half a day: the reset is tomorrow (11 pm, "resets 1 am").
      // Past by less: an old message the screen redrew -- that limit has reset.
      if (at < now - 12 * 3600e3) at += 86400e3
      else if (at < now - 60_000) return null
      return { resetAt: at, message: said(timeOnly.index + timeOnly[0].length) }
    }
  }
  return null
}

type PtyState = {
  text: string
  /** Until when a stop with no time yet is looked at again (the time may follow). */
  armedUntil: number
  tries: number
  handled: Map<string, number>
}

/** The watcher: one per app. Exported as a class so tests get their own. */
export class QuotaResume {
  private readonly ptys = new Map<string, PtyState>()
  private readonly pending = new Map<string, PendingResume & { timer: unknown }>()
  private readonly recent: QuotaResumeEvent[] = []
  private runtime: QuotaResumeRuntime | null = null
  private stateFile: string | null = null
  private logFile: string | null = null
  private enabled = true

  constructor(
    private readonly opts: {
      now?: () => number
      /** Timers, swappable for tests. A handle is opaque: Node's and the DOM's differ. */
      setTimer?: (fn: () => void, ms: number) => unknown
      clearTimer?: (t: unknown) => void
      submitDelayMs?: number
    } = {}
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now()
  }

  private later(fn: () => void, ms: number): unknown {
    return this.opts.setTimer ? this.opts.setTimer(fn, ms) : setTimeout(fn, ms)
  }

  private drop(timer: unknown): void {
    if (this.opts.clearTimer) this.opts.clearTimer(timer)
    else clearTimeout(timer as Parameters<typeof clearTimeout>[0])
  }

  /** Where the on/off switch and the log live (userData/pulsaride-storage). */
  start(userData: string): void {
    const dir = join(userData, 'pulsaride-storage')
    this.stateFile = join(dir, 'quota-resume.json')
    this.logFile = join(dir, 'quota-resume.log.jsonl')
    try {
      if (existsSync(this.stateFile)) {
        const saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { enabled?: boolean }
        this.enabled = saved.enabled !== false
      }
    } catch {
      this.enabled = true
    }
  }

  setEnabled(enabled: boolean): QuotaResumeStatus {
    this.enabled = enabled
    if (!enabled) for (const id of [...this.pending.keys()]) this.cancel(id, 'turned off')
    if (this.stateFile) {
      try {
        mkdirSync(join(this.stateFile, '..'), { recursive: true })
        writeFileSync(this.stateFile, `${JSON.stringify({ enabled }, null, 2)}\n`)
      } catch {
        /* the switch still holds for this run */
      }
    }
    return this.status()
  }

  status(): QuotaResumeStatus {
    return {
      enabled: this.enabled,
      pending: [...this.pending.values()].map(({ timer: _timer, ...p }) => p),
      recent: this.recent.slice(-20)
    }
  }

  private note(e: Omit<QuotaResumeEvent, 'at'>): void {
    const event = { at: new Date(this.now()).toISOString(), ...e }
    this.recent.push(event)
    if (this.recent.length > 50) this.recent.splice(0, this.recent.length - 50)
    if (!this.logFile) return
    try {
      mkdirSync(join(this.logFile, '..'), { recursive: true })
      appendFileSync(this.logFile, `${JSON.stringify(event)}\n`)
    } catch {
      /* a log line is not worth a failure */
    }
  }

  /** Every chunk a pty prints. Cheap unless the chunk can be part of a stop. */
  ingest(ptyId: string, data: string, runtime?: QuotaResumeRuntime): void {
    try {
      if (runtime) this.runtime = runtime
      if (!this.enabled || typeof data !== 'string' || !data) return
      let state = this.ptys.get(ptyId)
      // Most panes never print a limit: they cost one test per chunk.
      if (!state && !/limit|quota/i.test(data)) return
      const chunk = terminalText(data)
      if (!state) {
        state = { text: '', armedUntil: 0, tries: 0, handled: new Map() }
        this.ptys.set(ptyId, state)
      }
      state.text = (state.text + chunk).slice(-BUFFER_CHARS)
      const now = this.now()
      if (!/limit|quota/i.test(chunk) && state.armedUntil < now) return
      const stop = parseQuotaStop(state.text, now)
      if (stop === null) {
        // A stop whose time has not arrived yet: look again at what follows.
        if (state.text.search(STOP) >= 0) state.armedUntil = now + 3000
        return
      }
      state.armedUntil = 0
      if (stop === 'native') return
      this.consider(ptyId, state, stop)
    } catch {
      /* never in the way of the terminal */
    }
  }

  private consider(ptyId: string, state: PtyState, stop: QuotaStop): void {
    const now = this.now()
    for (const [key, at] of state.handled) if (now - at > HANDLED_TTL_MS) state.handled.delete(key)
    // One stop per reset time per pane: the screen redrawn says the same again.
    const key = String(Math.round(stop.resetAt / 60_000))
    if (state.handled.has(key)) return
    state.handled.set(key, now)
    const agent = this.runtime?.getPtyAgent?.(ptyId) ?? null
    if (!agent || SKIP_AGENTS.has(agent)) {
      this.note({ ptyId, agent: agent ?? 'unknown', event: 'skipped', detail: agent ? `${agent} continues by itself` : 'no agent known in this pane' })
      return
    }
    if (stop.resetAt - now > MAX_AHEAD_MS) return
    if (state.tries >= MAX_TRIES) {
      this.note({ ptyId, agent, event: 'gave-up', detail: `still limited after ${MAX_TRIES} resumes: ${stop.message}` })
      return
    }
    const existing = this.pending.get(ptyId)
    if (existing) this.drop(existing.timer)
    const fireAt = Math.max(stop.resetAt, now) + RESUME_GRACE_MS
    const timer = this.later(() => this.fire(ptyId), Math.max(0, fireAt - now))
    this.pending.set(ptyId, { ptyId, agent, detectedAt: now, resetAt: stop.resetAt, fireAt, message: stop.message, timer })
    this.note({ ptyId, agent, event: 'scheduled', detail: `${new Date(fireAt).toISOString()} -- ${stop.message}` })
  }

  /** What the user typed into a pane: they are there, so the pane is theirs again. */
  noteInput(ptyId: string, data: unknown): void {
    try {
      if (typeof data !== 'string') return
      // Focus reports and terminal query answers are the terminal, not the user.
      const typed = data.replace(
        /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*?\x1b\\|\x1bO[A-Za-z]/g,
        ''
      )
      if (!typed) return
      const state = this.ptys.get(ptyId)
      if (state) state.tries = 0
      if (this.pending.has(ptyId)) this.cancel(ptyId, 'you typed in this pane')
    } catch {
      /* never in the way of the keyboard */
    }
  }

  /** A pane that closed. */
  forget(ptyId: string): void {
    const p = this.pending.get(ptyId)
    if (p) this.drop(p.timer)
    this.pending.delete(ptyId)
    this.ptys.delete(ptyId)
  }

  cancel(ptyId: string, why = 'cancelled'): void {
    const p = this.pending.get(ptyId)
    if (!p) return
    this.drop(p.timer)
    this.pending.delete(ptyId)
    this.note({ ptyId, agent: p.agent, event: 'cancelled', detail: why })
  }

  private fire(ptyId: string): void {
    const p = this.pending.get(ptyId)
    if (!p) return
    // A computer that slept wakes with timers late, never early; one that is
    // early anyway waits for the rest.
    const left = p.fireAt - this.now()
    if (left > 1000) {
      p.timer = this.later(() => this.fire(ptyId), left)
      return
    }
    this.pending.delete(ptyId)
    if (!this.enabled) return
    const write = this.runtime?.ptyController?.write.bind(this.runtime.ptyController)
    const state = this.ptys.get(ptyId)
    try {
      // The text, then Enter on its own: a TUI that reads fast input as a
      // paste would take an Enter inside it as a new line, not a send.
      if (!write || !write(ptyId, RESUME_TEXT)) {
        this.note({ ptyId, agent: p.agent, event: 'cancelled', detail: 'the pane is gone' })
        this.ptys.delete(ptyId)
        return
      }
      if (state) state.tries += 1
      this.later(() => {
        try {
          write(ptyId, '\r')
        } catch {
          /* the pane closed in between */
        }
      }, this.opts.submitDelayMs ?? 700)
      this.note({ ptyId, agent: p.agent, event: 'resumed', detail: `typed "${RESUME_TEXT}" after: ${p.message}` })
    } catch (e) {
      this.note({ ptyId, agent: p.agent, event: 'cancelled', detail: `could not type into the pane: ${String(e)}` })
    }
  }
}

/** The app's one watcher: fed by Orca's pty data path and its pty:write handler. */
export const quotaResume = new QuotaResume()

/** Called from the runtime's onPtyData for every chunk (apply.py). */
export function ingestQuotaResume(ptyId: string, data: string, runtime?: QuotaResumeRuntime): void {
  quotaResume.ingest(ptyId, data, runtime)
}

/** Called from the pty:write IPC handler for every keystroke batch (apply.py). */
export function noteQuotaResumeInput(ptyId: string, data: unknown): void {
  quotaResume.noteInput(ptyId, data)
}
