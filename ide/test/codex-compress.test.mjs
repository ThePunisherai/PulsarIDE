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
  existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MOD = process.env.PULSAR_CHATS_CJS
const {
  codexHomes, compressCodexChats, restoreCodexChats, measureCodexChats,
  readChatsState, setChatsCompression, runChatsCompression
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

// --- what Explorer shows vs what the disk holds ---------------------------- //
const before = await measureCodexChats({ homes })
const ownLen = chat.replace(/step/g, 'own').length
ok('measure: Explorer counts every link, the disk holds each chat once',
  before.logicalBytes === 5 * chat.length + ownLen &&
  before.physicalBytes === 3 * chat.length + ownLen &&
  before.plainChats === 4 && before.compressedChats === 0)
// Where the total sits, so the Toolkit can say why it is not smaller: the
// recent chat is in use, the one linked from outside is left alone, and only
// the rest is what a run will take.
ok('measure: in use, linked elsewhere and still to compress are told apart',
  before.recentPlainBytes === chat.length && before.linkedElsewhereBytes === chat.length &&
  before.coldPlainBytes === chat.length + ownLen && before.compressedBytes === 0)

// --- compress -------------------------------------------------------------- //
const rep = await compressCodexChats({ homes, minAgeDays: 30 })
const zA = join(homeA, day, `${name}.zst`)
ok('compress: the shared old chat and the lone old chat are compressed, nothing failed',
  rep.done === 2 && rep.failed === 0 && rep.bytesAfter < rep.bytesBefore / 5)
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

const again = await compressCodexChats({ homes, minAgeDays: 30 })
ok('compress: a second run finds nothing left to do', again.done === 0 && again.failed === 0)
const after = await measureCodexChats({ homes })
ok('measure: the two compressed chats now take a fraction of their old space on disk',
  after.compressedChats === 2 && after.plainChats === 2 &&
  before.physicalBytes - after.physicalBytes > 0.8 * (chat.length + ownLen))
ok('measure: nothing is left to compress; the compressed bytes are counted on their own',
  after.coldPlainBytes === 0 && after.compressedBytes > 0 && after.compressedBytes < (chat.length + ownLen) / 5)

// Codex resumed one chat in one home and decompressed it there itself, the way
// it materializes a .zst for appending: the plain file appears, that home's
// .zst link goes, the other homes keep theirs.
{
  const plainB = join(homeB, day, name)
  writeFileSync(plainB, zstdDecompressSync(readFileSync(join(homeB, day, `${name}.zst`))))
  rmSync(join(homeB, day, `${name}.zst`))
}
const mixed = await compressCodexChats({ homes, minAgeDays: 30 })
ok('compress: a chat resumed (plain again) in one home while others hold the .zst is not touched twice',
  mixed.failed === 0 && existsSync(join(homeB, day, name)))

// --- restore --------------------------------------------------------------- //
const back = await restoreCodexChats({ homes })
ok('restore: every compressed chat is plain again, nothing failed', back.failed === 0 && back.done >= 2)
ok('restore: byte for byte what it was, in every home',
  [homeA, runtime].every((h) => existsSync(join(h, day, name)) && sha(join(h, day, name)) === sharedSha) &&
  sha(own) === ownSha)
ok('restore: no .zst left behind',
  [homeA, runtime].every((h) => !existsSync(join(h, day, `${name}.zst`))) && !existsSync(`${own}.zst`))
ok('restore: the homes share one file again (hardlinks)',
  statSync(join(homeA, day, name)).ino === statSync(join(runtime, day, name)).ino)

// --- the automatic part ---------------------------------------------------- //
ok('state: automatic compression is on until the user turns it off', readChatsState(userData).enabled === true)
ok('state: the switch sticks', setChatsCompression(userData, false).enabled === false &&
  readChatsState(userData).enabled === false && setChatsCompression(userData, true).enabled === true)
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
