/**
 * Codex chats, kept whole and a fraction of the size.
 *
 * Asked for directly: "wat veel opslag pikt zonder dat ik mijn chats history
 * kwijt ben". Every Codex chat is a `rollout-*.jsonl` transcript under a Codex
 * home's sessions/ -- the file `codex resume` reads -- and long ones reach 2 GB.
 * Orca runs Codex in a home per account (<userData>/codex-accounts/<id>/home,
 * codex-runtime-home/home) and links the same transcript into every one of
 * them, which is why Explorer adds up to hundreds of GB while far less is on
 * the disk.
 *
 * Codex reads `rollout-*.jsonl.zst` itself -- zstd, transparently, and
 * decompresses a chat back to plain .jsonl the moment it is resumed
 * (openai/codex codex-rs/rollout/src/compression.rs, the same level 3 and the
 * same "cold" rule its own, still-flagged worker uses). Orca resolves and resumes
 * .jsonl.zst too. So a cold chat is compressed in place, losslessly:
 *
 *  - only transcripts nobody touched for `minAgeDays` (default 30);
 *  - every hardlink of one transcript is found across all the Codex homes and
 *    replaced together by links to ONE compressed file -- compressing per home
 *    would free nothing while the other homes' links keep the original alive,
 *    and a transcript also linked from somewhere we do not scan is left alone;
 *  - the compressed file is decompressed again and its SHA-256 compared with
 *    the original's before anything is removed, the source is re-checked for
 *    changes, and the chat's own date is kept on the new file;
 *  - nothing is overwritten: an existing .zst beside a transcript means skip.
 *
 * Restore (`restoreCodexChats`) turns every .jsonl.zst back into plain .jsonl
 * the same way. Never throws to its caller: a cleanup must not take anything
 * else down with it.
 */
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { readdir, stat, statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { constants as Z, createZstdCompress, createZstdDecompress } from 'node:zlib'

const PLAIN = /^rollout-.+\.jsonl$/
const COMPRESSED = /^rollout-.+\.jsonl\.zst$/
/** What a run killed halfway (app closed, power cut) leaves behind. */
const LEFTOVER = /^rollout-.+\.jsonl(\.zst\.pulsar-\d+|\.pulsar-restore-\d+)\.tmp$/
const SESSION_DIRS = ['sessions', 'archived_sessions']
const DAY_MS = 24 * 3600e3

export type ChatsReport = {
  at: string
  /** Groups of links to one transcript that were compressed (or restored). */
  done: number
  skipped: number
  failed: number
  /** Disk bytes before and after, counting each transcript once however many homes link it. */
  bytesBefore: number
  bytesAfter: number
  /** Ran out of its time budget; the next run picks up where this one stopped. */
  partial: boolean
  /** Why chats were left as they were: linked-elsewhere, has-zst, no-space, changed. */
  skippedWhy: Record<string, number>
  errors: string[]
}

export type ChatsMeasure = {
  /** What Explorer shows: every link counted. */
  logicalBytes: number
  /** What the disk holds: each transcript once. */
  physicalBytes: number
  plainChats: number
  compressedChats: number
  /** Disk bytes in plain transcripts old enough to compress -- what a run will take. */
  coldPlainBytes: number
  /** Disk bytes in compressed transcripts. */
  compressedBytes: number
  /** Disk bytes in chats touched within the cold age: in use, compressed once quiet. */
  recentPlainBytes: number
  /** Disk bytes in old chats also linked from outside the Codex homes: left alone. */
  linkedElsewhereBytes: number
  homes: number
}

type Found = { path: string; size: number; mtimeMs: number; atimeMs: number; nlink: number; key: string }

/** One transcript and every link to it in the scanned homes. */
type Group = { key: string; paths: string[]; size: number; mtimeMs: number; atimeMs: number; nlink: number }

// --------------------------------------------------------------------------- where

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * The Codex homes on this machine that hold chats: Orca's per-account and
 * runtime homes under this app's data folder and under Orca's own (when Orca
 * ran here before PulsarIDE), and the user's own ~/.codex (or $CODEX_HOME).
 */
export function codexHomes(
  userData: string,
  opts: { home?: string; env?: NodeJS.ProcessEnv } = {}
): string[] {
  const home = opts.home ?? homedir()
  const env = opts.env ?? process.env
  const bases = [resolve(userData)]
  const orca = resolve(dirname(userData), 'orca')
  if (orca !== bases[0]) bases.push(orca)
  const out = new Set<string>()
  for (const base of bases) {
    const accounts = join(base, 'codex-accounts')
    for (const id of listDir(accounts)) out.add(join(accounts, id, 'home'))
    out.add(join(base, 'codex-runtime-home', 'home'))
    out.add(join(base, 'codex-runtime-home', 'active', 'host', 'home'))
  }
  out.add(resolve(env.CODEX_HOME?.trim() || join(home, '.codex')))
  return [...out].filter((h) => SESSION_DIRS.some((d) => existsSync(join(h, d))))
}

async function walk(root: string, match: RegExp, out: string[]): Promise<void> {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile() && match.test(e.name)) out.push(full)
    }
  }
}

async function findAll(homes: string[], match: RegExp): Promise<Found[]> {
  const paths: string[] = []
  for (const h of homes) for (const d of SESSION_DIRS) await walk(join(h, d), match, paths)
  const seen = new Set<string>()
  const found: Found[] = []
  for (const path of paths) {
    const real = resolve(path)
    if (seen.has(real)) continue
    seen.add(real)
    try {
      const st = await stat(real, { bigint: true })
      found.push({
        path: real,
        size: Number(st.size),
        mtimeMs: Number(st.mtimeMs),
        atimeMs: Number(st.atimeMs),
        nlink: Number(st.nlink),
        key: `${st.dev}:${st.ino}`
      })
    } catch {
      /* gone between the walk and the stat: nothing to do */
    }
  }
  return found
}

function groupByFile(found: Found[]): Group[] {
  const groups = new Map<string, Group>()
  for (const f of found) {
    const g = groups.get(f.key)
    if (g) g.paths.push(f.path)
    else
      groups.set(f.key, {
        key: f.key,
        paths: [f.path],
        size: f.size,
        mtimeMs: f.mtimeMs,
        atimeMs: f.atimeMs,
        nlink: f.nlink
      })
  }
  return [...groups.values()]
}

// --------------------------------------------------------------------------- streams

/** Counts and hashes what flows through, unchanged. */
function tap(hash: ReturnType<typeof createHash>, count: { n: number }): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk)
      count.n += chunk.length
      cb(null, chunk)
    }
  })
}

const sink = (): Writable =>
  new Writable({
    write(_chunk, _enc, cb) {
      cb()
    }
  })

async function zstdTo(source: string, target: string, level: number): Promise<{ sha: string; bytes: number }> {
  const hash = createHash('sha256')
  const count = { n: 0 }
  await pipeline(
    createReadStream(source),
    tap(hash, count),
    createZstdCompress({ params: { [Z.ZSTD_c_compressionLevel]: level, [Z.ZSTD_c_checksumFlag]: 1 } }),
    createWriteStream(target, { flags: 'wx' })
  )
  return { sha: hash.digest('hex'), bytes: count.n }
}

async function unzstdHash(source: string, target: string | null): Promise<{ sha: string; bytes: number }> {
  const hash = createHash('sha256')
  const count = { n: 0 }
  await pipeline(
    createReadStream(source),
    createZstdDecompress(),
    tap(hash, count),
    target ? createWriteStream(target, { flags: 'wx' }) : sink()
  )
  return { sha: hash.digest('hex'), bytes: count.n }
}

async function freeBytes(dir: string): Promise<number> {
  try {
    const s = await statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return Number.POSITIVE_INFINITY // cannot tell: let the write itself decide
  }
}

function tryUnlink(path: string): boolean {
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

/** A new link to `from` at `to`, never over an existing file. */
function linkNew(from: string, to: string): void {
  linkSync(from, to)
}

// --------------------------------------------------------------------------- compress

type Ctx = { report: ChatsReport; started: number; budgetMs: number; log?: (line: string) => void }

function skip(r: ChatsReport, why: string): void {
  r.skipped += 1
  r.skippedWhy[why] = (r.skippedWhy[why] ?? 0) + 1
}

function outOfTime(ctx: Ctx): boolean {
  if (Date.now() - ctx.started < ctx.budgetMs) return false
  ctx.report.partial = true
  return true
}

async function compressGroup(g: Group, level: number, ctx: Ctx): Promise<void> {
  const r = ctx.report
  // Linked from somewhere we do not scan: compressing our links frees nothing.
  if (g.nlink > g.paths.length) {
    skip(r, 'linked-elsewhere')
    return
  }
  if (g.paths.some((p) => existsSync(`${p}.zst`))) {
    skip(r, 'has-zst')
    return
  }
  const first = g.paths[0]
  if ((await freeBytes(dirname(first))) < g.size) {
    skip(r, 'no-space')
    return
  }
  const tmp = `${first}.zst.pulsar-${process.pid}.tmp`
  const made: string[] = []
  try {
    const original = await zstdTo(first, tmp, level)
    const check = await unzstdHash(tmp, null)
    if (check.sha !== original.sha || check.bytes !== original.bytes || original.bytes !== g.size) {
      throw new Error(`verification failed for ${first}`)
    }
    // Written to while we read it: leave it for a later run.
    const now = await stat(first, { bigint: true })
    if (Number(now.size) !== g.size || Number(now.mtimeMs) !== g.mtimeMs || Number(now.nlink) !== g.nlink) {
      tryUnlink(tmp)
      skip(r, 'changed')
      return
    }
    // The chat keeps its own date: Codex lists sessions by it.
    utimesSync(tmp, g.atimeMs / 1000, g.mtimeMs / 1000)
    const after = (await stat(tmp)).size
    for (const p of g.paths) {
      linkNew(tmp, `${p}.zst`)
      made.push(`${p}.zst`)
    }
    tryUnlink(tmp)
    // Only now the plain copies go. One still held open keeps its home on the
    // plain file -- and drops that home's .zst, so each home has one form.
    let kept = 0
    for (const p of g.paths) {
      if (!tryUnlink(p)) {
        tryUnlink(`${p}.zst`)
        kept += 1
      }
    }
    r.done += 1
    r.bytesBefore += g.size
    r.bytesAfter += kept ? g.size + after : after
    ctx.log?.(JSON.stringify({ at: new Date().toISOString(), compressed: g.paths, before: g.size, after }))
  } catch (err) {
    for (const m of made) tryUnlink(m)
    tryUnlink(tmp)
    r.failed += 1
    if (r.errors.length < 20) r.errors.push(err instanceof Error ? err.message : String(err))
  }
}

const emptyReport = (): ChatsReport => ({
  at: new Date().toISOString(),
  done: 0,
  skipped: 0,
  failed: 0,
  bytesBefore: 0,
  bytesAfter: 0,
  partial: false,
  skippedWhy: {},
  errors: []
})

/**
 * Temp files an interrupted run left: never a transcript, always ours by name,
 * and only once they are old enough that no run in progress can own them.
 */
async function clearLeftovers(homes: string[]): Promise<void> {
  for (const f of await findAll(homes, LEFTOVER)) {
    if (Date.now() - f.mtimeMs > 6 * 3600e3) tryUnlink(f.path)
  }
}

/** Compress every cold Codex chat in `homes`, losslessly. Never throws. */
export async function compressCodexChats(opts: {
  homes: string[]
  minAgeDays?: number
  level?: number
  budgetMs?: number
  now?: number
  log?: (line: string) => void
}): Promise<ChatsReport> {
  const report = emptyReport()
  const ctx: Ctx = { report, started: Date.now(), budgetMs: opts.budgetMs ?? 30 * 60e3, log: opts.log }
  try {
    await clearLeftovers(opts.homes)
    const cutoff = (opts.now ?? Date.now()) - (opts.minAgeDays ?? 30) * DAY_MS
    const groups = groupByFile(await findAll(opts.homes, PLAIN))
      .filter((g) => g.mtimeMs < cutoff)
      .sort((a, b) => b.size - a.size) // the biggest first: most space per minute
    for (const g of groups) {
      if (outOfTime(ctx)) break
      await compressGroup(g, opts.level ?? 3, ctx)
    }
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err))
  }
  return report
}

// --------------------------------------------------------------------------- restore

async function restoreGroup(g: Group, ctx: Ctx): Promise<void> {
  const r = ctx.report
  if (g.nlink > g.paths.length) {
    skip(r, 'linked-elsewhere')
    return
  }
  const first = g.paths[0].replace(/\.zst$/, '')
  // Decompressed size is unknown until it is written; ask for ten times the
  // compressed size, which covers ordinary chats.
  if ((await freeBytes(dirname(first))) < g.size * 10) {
    skip(r, 'no-space')
    if (r.errors.length < 20) r.errors.push(`not enough free space to restore ${first}`)
    return
  }
  const tmp = `${first}.pulsar-restore-${process.pid}.tmp`
  const made: string[] = []
  try {
    // zstd's own checksum (written on compression) fails the stream if corrupt.
    await unzstdHash(g.paths[0], tmp)
    utimesSync(tmp, g.atimeMs / 1000, g.mtimeMs / 1000)
    const plainSize = (await stat(tmp)).size
    for (const z of g.paths) {
      const plain = z.replace(/\.zst$/, '')
      if (existsSync(plain)) continue // already plain in this home (Codex resumed it)
      linkNew(tmp, plain)
      made.push(plain)
    }
    tryUnlink(tmp)
    for (const z of g.paths) tryUnlink(z)
    r.done += 1
    r.bytesBefore += g.size
    r.bytesAfter += plainSize
    ctx.log?.(JSON.stringify({ at: new Date().toISOString(), restored: made, before: g.size, after: plainSize }))
  } catch (err) {
    for (const m of made) tryUnlink(m)
    tryUnlink(tmp)
    r.failed += 1
    if (r.errors.length < 20) r.errors.push(err instanceof Error ? err.message : String(err))
  }
}

/** Every compressed Codex chat back to plain .jsonl. Never throws. */
export async function restoreCodexChats(opts: {
  homes: string[]
  budgetMs?: number
  log?: (line: string) => void
}): Promise<ChatsReport> {
  const report = emptyReport()
  const ctx: Ctx = { report, started: Date.now(), budgetMs: opts.budgetMs ?? 60 * 60e3, log: opts.log }
  try {
    for (const g of groupByFile(await findAll(opts.homes, COMPRESSED))) {
      if (outOfTime(ctx)) break
      await restoreGroup(g, ctx)
    }
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err))
  }
  return report
}

// --------------------------------------------------------------------------- measure

/** What the chats take: as Explorer counts it, and as the disk holds it. */
export async function measureCodexChats(opts: {
  homes: string[]
  minAgeDays?: number
  now?: number
}): Promise<ChatsMeasure> {
  const plain = await findAll(opts.homes, PLAIN)
  const zst = await findAll(opts.homes, COMPRESSED)
  const cutoff = (opts.now ?? Date.now()) - (opts.minAgeDays ?? 30) * DAY_MS
  const plainGroups = groupByFile(plain)
  const zstGroups = groupByFile(zst)
  const sum = (xs: { size: number }[]): number => xs.reduce((n, x) => n + x.size, 0)
  const cold = plainGroups.filter((g) => g.mtimeMs < cutoff)
  const elsewhere = cold.filter((g) => g.nlink > g.paths.length)
  return {
    logicalBytes: sum(plain) + sum(zst),
    physicalBytes: sum(plainGroups) + sum(zstGroups),
    plainChats: plainGroups.length,
    compressedChats: zstGroups.length,
    coldPlainBytes: sum(cold) - sum(elsewhere),
    compressedBytes: sum(zstGroups),
    recentPlainBytes: sum(plainGroups) - sum(cold),
    linkedElsewhereBytes: sum(elsewhere),
    homes: opts.homes.length
  }
}

// --------------------------------------------------------------------------- automatic

export type ChatsState = {
  /** Automatic compression; on unless the user turned it off. */
  enabled: boolean
  lastRun: string
  lastReport: ChatsReport | null
  /** Over every run: transcripts compressed and disk bytes freed. */
  totalDone: number
  totalFreed: number
}

const stateDir = (userData: string): string => join(userData, 'pulsaride-storage')
const stateFile = (userData: string): string => join(stateDir(userData), 'codex-chats.json')

export function readChatsState(userData: string): ChatsState {
  try {
    const raw = JSON.parse(readFileSync(stateFile(userData), 'utf8')) as Partial<ChatsState>
    return {
      enabled: raw.enabled !== false,
      lastRun: raw.lastRun ?? '',
      lastReport: raw.lastReport ?? null,
      totalDone: raw.totalDone ?? 0,
      totalFreed: raw.totalFreed ?? 0
    }
  } catch {
    return { enabled: true, lastRun: '', lastReport: null, totalDone: 0, totalFreed: 0 }
  }
}

function writeChatsState(userData: string, state: ChatsState): void {
  try {
    mkdirSync(stateDir(userData), { recursive: true })
    const file = stateFile(userData)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(tmp, file)
  } catch {
    /* the next run recomputes; nothing is lost */
  }
}

export function setChatsCompression(userData: string, enabled: boolean): ChatsState {
  const state = { ...readChatsState(userData), enabled }
  writeChatsState(userData, state)
  return state
}

let running: Promise<ChatsReport> | null = null

/** One run, unless one is already going in this process. Records the outcome. */
export function runChatsCompression(
  userData: string,
  opts: { home?: string; budgetMs?: number; minAgeDays?: number } = {}
): Promise<ChatsReport> {
  if (running) return running
  const logFile = join(stateDir(userData), 'codex-chats.log.jsonl')
  const log = (line: string): void => {
    try {
      mkdirSync(stateDir(userData), { recursive: true })
      appendFileSync(logFile, `${line}\n`)
    } catch {
      /* the transcripts are what matter; a log line is not */
    }
  }
  running = compressCodexChats({
    homes: codexHomes(userData, { home: opts.home }),
    budgetMs: opts.budgetMs,
    minAgeDays: opts.minAgeDays,
    log
  })
    .then((report) => {
      const prev = readChatsState(userData)
      writeChatsState(userData, {
        ...prev,
        lastRun: report.at,
        lastReport: report,
        totalDone: prev.totalDone + report.done,
        totalFreed: prev.totalFreed + Math.max(0, report.bytesBefore - report.bytesAfter)
      })
      return report
    })
    .finally(() => {
      running = null
    })
  return running
}

export const chatsCompressionRunning = (): boolean => running !== null

/**
 * The automatic part: a first run ten minutes after launch, then once a day,
 * each one bounded to half an hour of work and picking up where the last one
 * stopped. Off when the user turned it off. Started once, from the main
 * process, which lives as long as the app does.
 */
export function startChatsCompression(userData: string): void {
  const tick = (): void => {
    if (!readChatsState(userData).enabled) return
    void runChatsCompression(userData).catch(() => undefined)
  }
  setTimeout(tick, 10 * 60e3)
  setInterval(tick, DAY_MS)
}
