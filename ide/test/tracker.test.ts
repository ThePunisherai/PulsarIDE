/**
 * Tracker self-test: the real main-process modules, run for real.
 *
 * Bundled and executed by ide/verify.sh -- no Electron needed, because the
 * tracker is plain Node code that only touches the filesystem.
 */

import * as store from '../overlay/src/main/planide/store'
import { detect } from '../overlay/src/main/planide/detect'
import { buildReport } from '../overlay/src/main/planide/report'
import * as backup from '../overlay/src/main/planide/backup'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let pass = 0, fail = 0
const ok = (n: string, c: boolean): void => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)) }

// a realistic project on disk
const proj = mkdtempSync(join(tmpdir(), 'planide-'))
mkdirSync(join(proj, 'src'))
writeFileSync(join(proj, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)')
writeFileSync(join(proj, 'src', 'cpu.cpp'), 'int execute_opcode(unsigned op){return 0;}')
writeFileSync(join(proj, 'src', 'ppu.cpp'), '// pixel unit')

console.log('== detect ==')
const d = detect(proj)
ok('type is emulator (opcode/cpu hints)', d.type === 'emulator')
ok('C++ detected', d.languages.includes('C++'))
ok('cmake marker found', d.stack.includes('cmake'))
ok('confidence high', d.confidence === 'high')

console.log('== store: create + persist ==')
let st = store.loadState(proj)
ok('blank state has a name', st.name.length > 0)
const a = store.addItem(st, { title: 'ARM7 CPU core', status: 'done' })
const b = store.addItem(st, { title: 'PPU rendering', status: 'works', claimedBy: 'Claude' })
store.addItem(st, { title: 'Link cable', status: 'todo' })
store.saveState(proj, st)
st = store.loadState(proj)
ok('state round-trips to disk', st.items.length === 3)
ok('claimed_by persisted', st.items[1].claimed_by === 'Claude')

console.log('== trust boundary ==')
store.updateItem(st, a.id, { verified: true } as never)
ok('updateItem cannot set verified', st.items[0].verified === false)
store.updateItem(st, a.id, { locked: true } as never)
ok('updateItem cannot set locked', st.items[0].locked === false)
store.verifyItem(st, a.id, true)
ok('verifyItem confirms', st.items[0].verified === true)
store.lockItem(st, a.id, true)
ok('lockItem protects', st.items[0].locked === true)
store.updateItem(st, a.id, { status: 'broken', claimed_by: 'Codex' })
ok('status change drops confirmation', st.items[0].verified === false)
ok('protection survives a status change', st.items[0].locked === true)
ok('regression detected', store.regressions(st).length === 1)

console.log('== progress ==')
const p = store.progress(st)
ok('claimed vs confirmed are separate', p.percent !== p.confirmed_percent || p.confirmed === 0)
ok('regressed counted', p.regressed === 1)
ok('protected counted', p.protected === 1)
ok('open counted (todo)', p.open === 1)
ok('health hit hard by regression', p.health < 20)

console.log('== activity ==')
const kinds = new Set(st.activity.map((x) => x.kind))
ok('logs item-add', kinds.has('item-add'))
ok('logs lock + verify', kinds.has('lock') && kinds.has('verify'))
ok('attributes the agent', st.activity.some((x) => x.who === 'Codex'))
ok('names the regression', st.activity.some((x) => x.text.includes('REGRESSION')))

console.log('== briefing ==')
store.lockItem(st, b.id, true)
const md = buildReport(st, 'full')
ok('leads with REGRESSION', md.indexOf('REGRESSION') < md.indexOf('## What works'))
ok('has DO NOT BREAK', md.includes('DO NOT BREAK (protected by the user)'))
ok('separates confirmed from claimed', md.includes('Reported working, NOT yet confirmed'))
ok('tells agent not to self-confirm', md.includes('only records a claim'))

console.log('== backup (own zip writer) ==')
store.saveState(proj, st)
const r = backup.create(proj, st.version, 'test')
ok('snapshot created', r.ok === true && (r.files ?? 0) > 0)
const list = backup.listing(proj)
ok('snapshot listed', list.length === 1 && list[0].file === r.file)
const second = backup.create(proj, st.version, 'nested')
ok('a second snapshot does not nest the first', (second.files ?? 0) === (r.files ?? 0))

// The ZIP is hand-written (no archive dependency), so prove an independent
// reader accepts it rather than trusting our own writer.
if (process.env.PLANIDE_ZIP_OUT) writeFileSync(process.env.PLANIDE_ZIP_OUT, r.path ?? '')

console.log('')
console.log(`PASS=${pass} FAIL=${fail}`)
if (fail) process.exit(1)
