/**
 * Design harness: renders the real tracker surfaces in a browser so the design
 * can be looked at, not guessed at.
 *
 * Real components, the real engine client, the real main-process store — the
 * only things swapped are Node's fs/path/crypto (in-memory shims) and Orca's
 * own app-shell imports (its actual Button is copied in as-is). Data below is
 * a plausible project, written through the same store functions the IDE uses.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import * as store from '../overlay/src/main/planide/store'
import { buildReport } from '../overlay/src/main/planide/report'
import PlanIdeView from '../overlay/src/renderer/src/components/planide/PlanIdeView'
import PlanIdePanel from '../overlay/src/renderer/src/components/right-sidebar/PlanIdePanel'

const PATH = '/home/you/projects/rakion-emu'

// --- a project with something to say ---------------------------------------
const state = store.loadState(PATH)
state.name = 'rakion-emu'
state.type = 'emulator'
state.version = '0.4.2'
state.stack = {
  detected: { type: 'emulator', languages: ['C++', 'Python'], stack: ['cmake', 'sdl2'], confidence: 'high' },
  custom: ''
}

const mk = (
  title: string,
  status: store.ItemStatus,
  opts: { notes?: string; by?: string; confirmed?: boolean; locked?: boolean } = {}
): void => {
  const it = store.addItem(state, { title, status, notes: opts.notes, claimedBy: opts.by })
  if (opts.confirmed) store.verifyItem(state, it.id, true)
  if (opts.locked) store.lockItem(state, it.id, true)
}

mk('ARM7 CPU core — all opcodes', 'done', { confirmed: true, locked: true })
mk('Sprite layer + palette', 'works', { confirmed: true, locked: true })
mk('Save states', 'works', { by: 'Codex', notes: 'Codex says this works. Not checked yet.' })
mk('Audio: channel 3 wave RAM', 'broken', { notes: 'Crackles after a reset.', by: 'Claude' })
mk('Link cable over TCP', 'blocked', { notes: 'Waiting on the protocol spec.' })
mk('Rewind buffer', 'wip', { by: 'Claude' })
mk('Cheat engine UI', 'todo')
mk('Per-game input profiles', 'todo')

// a regression: protected work that broke
const regressed = store.addItem(state, { title: 'Boot ROM timing', status: 'works' })
store.verifyItem(state, regressed.id, true)
store.lockItem(state, regressed.id, true)
store.updateItem(state, regressed.id, { status: 'broken', claimed_by: 'Codex' })

const fix = store.addFix(state, { title: 'Audio channel 3 crackle after reset', agent: 'claude' })
store.addFix(state, { title: 'Sprite flicker on scanline 144', agent: 'codex' })
store.updateFix(state, fix.id, { status: 'fixed', solution: 'Wave RAM was cleared on reset.' })

store.addMilestone(state, 'Playable: 10 commercial ROMs', '2026-09-30')
store.addMilestone(state, 'Netplay beta', '2026-11-15')
store.addVersion(state, '0.4.2', 'sprite layer + save states')

store.logActivity(state, 'agent-turn', 'finished a turn: fix the channel 3 crackle', 'claude')
store.logActivity(state, 'agent-said', 'Wave RAM was being cleared on reset; restored it and added a test.', 'claude')
store.logActivity(state, 'agent-turn', 'finished a turn: add save states', 'codex')
store.saveState(PATH, state)

// --- the bridge the renderer talks to --------------------------------------
const rollups = (): unknown => ({
  ...state,
  progress: store.progress(state),
  regressions: store.regressions(state),
  detected: state.stack.detected
})
const ok = <T,>(data: T): { ok: true; data: T } => ({ ok: true, data })
const after = <T,>(result: T): unknown => ok({ result, payload: rollups() })

;(globalThis as unknown as { api: unknown }).api = {
  planide: {
    open: async () => ok(rollups()),
    redetect: async () => ok(rollups()),
    addItem: async (_p: string, o: { title: string; status?: store.ItemStatus }) =>
      after(store.addItem(state, o)),
    updateItem: async (_p: string, id: string, f: Record<string, unknown>) =>
      (store.updateItem(state, id, f as never), ok(rollups())),
    deleteItem: async (_p: string, id: string) => (store.deleteItem(state, id), ok(rollups())),
    verifyItem: async (_p: string, id: string, v: boolean) =>
      (store.verifyItem(state, id, v), ok(rollups())),
    lockItem: async (_p: string, id: string, v: boolean) =>
      (store.lockItem(state, id, v), ok(rollups())),
    addFix: async (_p: string, o: { title: string }) => after(store.addFix(state, o)),
    markFixDone: async (_p: string, id: string) =>
      (store.updateFix(state, id, { status: 'fixed' }), ok(rollups())),
    addMilestone: async (_p: string, t: string, d: string) => after(store.addMilestone(state, t, d)),
    toggleMilestone: async (_p: string, id: string, done: boolean) =>
      (store.updateMilestone(state, id, { done }), ok(rollups())),
    addVersion: async (_p: string, v: string, n: string) => after(store.addVersion(state, v, n)),
    report: async (_p: string, mode: string) => ok(buildReport(state, mode as never)),
    gitStatus: async () => ok({ repo: true, branch: 'main', dirty: 3, remote: 'github.com/you/rakion-emu' }),
    backupList: async () => ok([])
  }
}

// --- the page ---------------------------------------------------------------
function Harness(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="flex min-w-0 flex-1 flex-col">
        <PlanIdeView />
      </div>
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-border bg-sidebar">
        <PlanIdePanel />
      </aside>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Harness />)
