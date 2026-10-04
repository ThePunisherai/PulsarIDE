#!/usr/bin/env node
/**
 * Codex chats, compressed without losing one (src/main/planide/codex-compress.ts).
 *
 * Run by verify.sh against an esbuild bundle of the module (PULSAR_CHATS_CJS).
 * Builds a fake userData with Orca's real layout -- one transcript hardlinked
 * into several account homes, the way Orca's session bridge does it -- and
 * checks that what comes back out is byte for byte what went in.
 */
import { createHash } from 'node:crypto'
import {
  existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MOD = process.env.PULSAR_CHATS_CJS
const {
  codexHomes, chatSources, compressCodexChats, restoreCodexChats, measureCodexChats,
  readChatsState, setChatsCompression, setChatsAge, runChatsCompression
} = await import(MOD)

let pass = 0
let fail = 0
const ok = (n, c) => c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n))
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const DAY = 24 * 3600e3

const root = mkdtempSync(join(tmpdir(), 'pulsar-chats-'))
const userData = join(root, 'AppData', 'Roaming', 'pulsaride')
const fakeHome = join(root, 'home')
const homeA = join(userData, 'codex-accounts', 'aaaa', 'home')
const homeB = join(userData, 'codex-accounts', 'bbbb', 'home')
const runtime = join(userData, 'codex-runtime-home', 'home')
const userCodex = join(fakeHome, '.codex')
const day = join('sessions', '2026', '07', '19')
for (const h of [homeA, homeB, runtime, userCodex]) mkdirSync(join(h, day), { recursive: true })

// A long chat: JSON lines like Codex writes, a few MB.
const line = (i) => JSON.stringify({ timestamp: `2026-07-19T18:00:${i}`, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `step ${i} `.repeat(40) }] } })
const chat = Array.from({ length: 20000 }, (_, i) => line(i)).join('\n') + '\n'
const old = (Date.now() - 60 * DAY) / 1000

const name = 'rollout-2026-07-19T18-55-24-019f7b4d-b9d5-7432-9dd7-1e9e76491e77.jsonl'
const shared = join(homeA, day, name)
writeFileSync(shared, chat)
utimesSync(shared, old, old)
// Orca links the same transcript into every account home and the runtime home.
linkSync(shared, join(homeB, day, name))
linkSync(shared, join(runtime, day, name))
const sharedSha = sha(shared)
const sharedMtime = statSync(shared).mtimeMs

// A chat from yesterday: in use, never touched.
const hot = join(homeA, day, 'rollout-2026-07-19T20-00-00-019f7b89-3e59-7b53-823c-1515511bac5a.jsonl')
writeFileSync(hot, chat)
// An old chat also linked from a folder no Codex home owns: compressing ours frees nothing.
const outside = join(homeB, day, 'rollout-2026-07-19T17-36-04-019f7b05-1a2a-70c3-9866-457b20499956.jsonl')
writeFileSync(outside, chat)
utimesSync(outside, old, old)
mkdirSync(join(root, 'elsewhere'), { recursive: true })
linkSync(outside, join(root, 'elsewhere', 'copy.jsonl'))
// An old chat in the user's own ~/.codex, alone.
const own = join(userCodex, day, 'rollout-2026-07-19T15-11-02-019f7a80-5094-7292-bcbb-3fd8f74aeac6.jsonl')
writeFileSync(own, chat.replace(/step/g, 'own'))
utimesSync(own, old, old)
const ownSha = sha(own)
// Not a transcript: never touched.
writeFileSync(join(homeA, day, 'notes.jsonl'), chat)
utimesSync(join(homeA, day, 'notes.jsonl'), old, old)
// What an interrupted run left behind, hours ago.
const leftover = join(homeA, day, `${name}.zst.pulsar-4242.tmp`)
writeFileSync(leftover, 'half a file')
utimesSync(leftover, old, old)

// --- where the chats are --------------------------------------------------- //
const homes = codexHomes(userData, { home: fakeHome, env: {} })
ok('homes: every account home, the runtime home and ~/.codex are found',
  [homeA, homeB, runtime, userCodex].every((h) => homes.includes(h)))
const orcaHome = join(dirname(userData), 'orca', 'codex-accounts', 'cccc', 'home')
mkdirSync(join(orcaHome, 'sessions'), { recursive: true })
ok("homes: Orca's own data folder beside ours is included",
  codexHomes(userData, { home: fakeHome, env: {} }).includes(orcaHome))
// Orca packaged is `Orca`, a source build `orca-dev`, and PulsarIDE before
// 0.11 kept its data in `planide`: all found, each under its own name.
{
  const dev = join(dirname(userData), 'orca-dev', 'codex-runtime-home', 'home')
  const old = join(dirname(userData), 'planide', 'codex-accounts', 'dddd', 'home')
  for (const h of [dev, old]) mkdirSync(join(h, 'sessions'), { recursive: true })
  // The same Orca folder reached under a second name (what `Orca` and `orca`
  // are on a case-insensitive disk): counted once.
  symlinkSync(join(dirname(userData), 'orca'), join(dirname(userData), 'Orca'))
  const sources = chatSources(userData, { home: fakeHome, env: {} })
  const apps = sources.map((s) => s.app)
  ok('detect: PulsarIDE, Orca, Orca (dev), the old PlanIDE folder and ~/.codex are each found',
    ['PulsarIDE', 'Orca', 'Orca (dev)', 'PlanIDE (before 0.11)', 'Codex'].every((a) => apps.includes(a)))
  ok('detect: one folder under two names is one source, its homes listed once',
    apps.filter((a) => a === 'Orca').length === 1 &&
    codexHomes(userData, { home: fakeHome, env: {} }).filter((h) => h.endsWith(join('cccc', 'home'))).length === 1)
  ok("detect: ownOnly leaves other apps' folders out (hooks stay this app's business)",
    !codexHomes(userData, { home: fakeHome, env: {}, ownOnly: true }).some((h) => /orca|planide/i.test(h.slice(dirname(userData).length))))
  rmSync(join(dirname(userData), 'Orca'))
  rmSync(join(dirname(userData), 'orca-dev'), { recursive: true })
  rmSync(join(dirname(userData), 'planide'), { recursive: true })
}
// An old chat that only Orca has: compressed like ours once Orca is detected.
const orcaDay = join(orcaHome, 'sessions', '2026', '06', '01')
mkdirSync(orcaDay, { recursive: true })
const orcaChat = join(orcaDay, 'rollout-2026-06-01T10-00-00-019e0000-0000-7000-8000-000000000001.jsonl')
writeFileSync(orcaChat, chat.replace(/step/g, 'orca'))
utimesSync(orcaChat, old, old)
const orcaSha = sha(orcaChat)

// --- what Explorer shows vs what the disk holds ---------------------------- //
const allHomes = codexHomes(userData, { home: fakeHome, env: {} })
const sources = chatSources(userData, { home: fakeHome, env: {} })
const before = await measureCodexChats({ homes: allHomes, sources })
const ownLen = chat.replace(/step/g, 'own').length
const orcaLen = chat.replace(/step/g, 'orca').length
ok('measure: Explorer counts every link, the disk holds each chat once',
  before.logicalBytes === 5 * chat.length + ownLen + orcaLen &&
  before.physicalBytes === 3 * chat.length + ownLen + orcaLen &&
  before.plainChats === 5 && before.compressedChats === 0)
const bySource = Object.fromEntries(before.sources.map((s) => [s.app, s]))
ok('measure: split per app -- what PulsarIDE, Orca and ~/.codex each hold',
  bySource.PulsarIDE.chats === 3 && bySource.PulsarIDE.bytes === 3 * chat.length &&
  bySource.Orca.chats === 1 && bySource.Orca.bytes === orcaLen &&
  bySource.Codex.chats === 1 && bySource.Codex.bytes === ownLen)
// Where the total sits, so the Toolkit can say why it is not smaller: the
// recent chat is in use, the one linked from outside is left alone, and only
// the rest is what a run will take.
ok('measure: in use, linked elsewhere and still to compress are told apart',
  before.recentPlainBytes === chat.length && before.linkedElsewhereBytes === chat.length &&
  before.coldPlainBytes === chat.length + ownLen + orcaLen && before.compressedBytes === 0)

// --- compress -------------------------------------------------------------- //
const rep = await compressCodexChats({ homes: allHomes, minAgeDays: 30 })
const zA = join(homeA, day, `${name}.zst`)
ok('compress: the shared old chat, the lone old chat and the Orca chat are compressed, nothing failed',
  rep.done === 3 && rep.failed === 0 && rep.bytesAfter < rep.bytesBefore / 5)
ok("compress: Orca's chat, detected beside ours, the same way -- lossless",
  existsSync(`${orcaChat}.zst`) && !existsSync(orcaChat) &&
  createHash('sha256').update(zstdDecompressSync(readFileSync(`${orcaChat}.zst`))).digest('hex') === orcaSha)
ok('compress: every home now has the .zst and none has the plain file',
  [homeA, homeB, runtime].every((h) => existsSync(join(h, day, `${name}.zst`)) && !existsSync(join(h, day, name))))
ok('compress: all homes share ONE compressed file (hardlinks), so the space is really freed',
  statSync(zA).nlink === 3 && statSync(zA).ino === statSync(join(homeB, day, `${name}.zst`)).ino)
ok('compress: a standard zstd frame Codex can read (magic 28 B5 2F FD)',
  readFileSync(zA).subarray(0, 4).toString('hex') === '28b52ffd')
ok('compress: lossless -- decompressed it is byte for byte the original',
  createHash('sha256').update(zstdDecompressSync(readFileSync(zA))).digest('hex') === sharedSha)
ok("compress: the chat keeps its own date (Codex lists sessions by it)",
  Math.abs(statSync(zA).mtimeMs - sharedMtime) < 1000)
ok('compress: a recent chat is left alone', existsSync(hot) && !existsSync(`${hot}.zst`))
ok('compress: a chat also linked from outside the Codex homes is left alone',
  existsSync(outside) && !existsSync(`${outside}.zst`))
ok('compress: and the report says why it was skipped',
  rep.skippedWhy['linked-elsewhere'] === 1)
ok('compress: files that are not transcripts are never touched',
  existsSync(join(homeA, day, 'notes.jsonl')) && !existsSync(join(homeA, day, 'notes.jsonl.zst')))
ok("compress: the user's own ~/.codex chat is compressed too",
  existsSync(`${own}.zst`) && !existsSync(own))
ok('compress: a half-written temp file from an interrupted run is cleared', !existsSync(leftover))

const again = await compressCodexChats({ homes: allHomes, minAgeDays: 30 })
ok('compress: a second run finds nothing left to do', again.done === 0 && again.failed === 0)
const after = await measureCodexChats({ homes: allHomes })
ok('measure: the three compressed chats now take a fraction of their old space on disk',
  after.compressedChats === 3 && after.plainChats === 2 &&
  before.physicalBytes - after.physicalBytes > 0.8 * (chat.length + ownLen + orcaLen))
ok('measure: nothing is left to compress; the compressed bytes are counted on their own',
  after.coldPlainBytes === 0 && after.compressedBytes > 0 && after.compressedBytes < (chat.length + ownLen + orcaLen) / 5)

// Codex resumed one chat in one home and decompressed it there itself, the way
// it materializes a .zst for appending: the plain file appears, that home's
// .zst link goes, the other homes keep theirs.
{
  const plainB = join(homeB, day, name)
  writeFileSync(plainB, zstdDecompressSync(readFileSync(join(homeB, day, `${name}.zst`))))
  rmSync(join(homeB, day, `${name}.zst`))
}
const mixed = await compressCodexChats({ homes: allHomes, minAgeDays: 30 })
ok('compress: a chat resumed (plain again) in one home while others hold the .zst is not touched twice',
  mixed.failed === 0 && existsSync(join(homeB, day, name)))

// --- restore --------------------------------------------------------------- //
const back = await restoreCodexChats({ homes: allHomes })
ok('restore: every compressed chat is plain again, nothing failed', back.failed === 0 && back.done >= 3)
ok('restore: byte for byte what it was, in every home -- Orca\'s too',
  [homeA, runtime].every((h) => existsSync(join(h, day, name)) && sha(join(h, day, name)) === sharedSha) &&
  sha(own) === ownSha && sha(orcaChat) === orcaSha)
ok('restore: no .zst left behind',
  [homeA, runtime].every((h) => !existsSync(join(h, day, `${name}.zst`))) && !existsSync(`${own}.zst`))
ok('restore: the homes share one file again (hardlinks)',
  statSync(join(homeA, day, name)).ino === statSync(join(runtime, day, name)).ino)

// --- the automatic part ---------------------------------------------------- //
ok('state: automatic compression is on until the user turns it off', readChatsState(userData).enabled === true)
ok('state: the switch sticks', setChatsCompression(userData, false).enabled === false &&
  readChatsState(userData).enabled === false && setChatsCompression(userData, true).enabled === true)
ok('age: 30 days until the user picks otherwise; 7, 14 and 30 are taken, anything else is not',
  readChatsState(userData).minAgeDays === 30 && setChatsAge(userData, 3).minAgeDays === 30 &&
  setChatsAge(userData, 7).minAgeDays === 7 && readChatsState(userData).minAgeDays === 7 &&
  readChatsState(userData).enabled === true)
// A chat ten days old: left alone at 30 days, compressed at 7.
{
  const tenDays = (Date.now() - 10 * DAY) / 1000
  const recent = join(homeA, day, 'rollout-2026-07-19T21-00-00-019f7b89-3e59-7b53-823c-1515511bac5b.jsonl')
  writeFileSync(recent, chat)
  utimesSync(recent, tenDays, tenDays)
  setChatsAge(userData, 30)
  await runChatsCompression(userData, { home: fakeHome })
  const kept = existsSync(recent) && !existsSync(`${recent}.zst`)
  setChatsAge(userData, 7)
  await runChatsCompression(userData, { home: fakeHome })
  ok('age: a ten-day-old chat waits at 30 days and is compressed at 7 -- the run reads the setting',
    kept && existsSync(`${recent}.zst`) && !existsSync(recent))
  setChatsAge(userData, 30)
}
for (const f of readdirSync(join(homeA, day))) {
  if (f.endsWith('.jsonl')) utimesSync(join(homeA, day, f), old, old)
}
const auto = await runChatsCompression(userData, { home: fakeHome })
const st = readChatsState(userData)
ok('state: a run records what it did and what it freed',
  auto.done >= 1 && st.lastRun === auto.at && st.totalDone >= 1 && st.totalFreed > 0 &&
  existsSync(join(userData, 'pulsaride-storage', 'codex-chats.log.jsonl')))

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
