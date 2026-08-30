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

const PATH = '/home/you/projects/acme-storefront'

// --- a project with something to say ---------------------------------------
// An ordinary web app, deliberately: the tracker is for whatever you are
// building, and a screenshot of a niche project makes it look like a niche tool.
const state = store.loadState(PATH)
state.name = 'acme-storefront'
state.type = 'web'
state.version = '1.4.0'
state.stack = {
  detected: {
    type: 'web',
    languages: ['TypeScript', 'CSS'],
    stack: ['next.js', 'tailwind', 'postgres'],
    confidence: 'high'
  },
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

mk('Checkout: Stripe payment flow', 'done', { confirmed: true, locked: true })
mk('Product search with filters', 'works', { confirmed: true, locked: true })
mk('Cart persists across sessions', 'works', { by: 'Codex', notes: 'Codex says this works. Not checked yet.' })
mk('Mobile nav traps focus when open', 'broken', { notes: 'Tab escapes the menu on iOS Safari.', by: 'Claude' })
mk('Ship to EU: VAT rates', 'blocked', { notes: 'Waiting on the finance spreadsheet.' })
mk('Order history page', 'wip', { by: 'Claude' })
mk('Wishlist', 'todo')
mk('Gift cards at checkout', 'todo')

// A card the way an agent really writes one. The fixture used to hold only
// one-line notes, so the board always looked tidy here while a real project's
// board -- where an agent had written fifteen lines into a single card -- was a
// wall of text in a narrow column. Keep at least one of these: an unrealistic
// fixture is how that shipped unnoticed.
mk('Rebuild the product page as a server component', 'wip', {
  by: 'Pulse Agent',
  notes:
    'Moved the gallery, variant picker and price block to server components and left ' +
    'only the add-to-cart button on the client; product JSON now streams from the ' +
    'route handler instead of a client fetch, so the first paint no longer waits on ' +
    'inventory. Lighthouse LCP is down from 3.1s to 1.4s on a throttled connection. ' +
    'Reviews, recommendations and the size guide still hydrate on the client and are ' +
    'the remaining work.'
})

// a regression: protected work that broke
const regressed = store.addItem(state, { title: 'Login with Google', status: 'works' })
store.verifyItem(state, regressed.id, true)
store.lockItem(state, regressed.id, true)
store.updateItem(state, regressed.id, { status: 'broken', claimed_by: 'Codex' })

const fix = store.addFix(state, { title: 'Mobile nav keeps focus behind the overlay', agent: 'claude' })
store.addFix(state, { title: 'Product images shift the layout while loading', agent: 'codex' })
store.updateFix(state, fix.id, { status: 'fixed', solution: 'The overlay never got aria-modal, so focus never moved.' })

store.addMilestone(state, 'Launch the new checkout', '2026-09-30')
store.addMilestone(state, 'Ship to the EU', '2026-11-15')
store.addVersion(state, '1.4.0', { notes: 'search filters + persistent cart' })

store.logActivity(state, 'agent-turn', 'finished a turn: fix the mobile nav focus trap', 'claude')
store.logActivity(state, 'agent-said', 'The overlay never set aria-modal, so focus stayed behind it. Added a test.', 'claude')
store.logActivity(state, 'agent-turn', 'finished a turn: keep the cart across sessions', 'codex')
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
    // The Brain Graph / Obsidian tabs. Shaped exactly like memory-status.ts
    // returns, with numbers of the size a real project produces.
    memoryStatus: async () =>
      ok({
        graphify: {
          available: true,
          nodes: 4182,
          edges: 9734,
          communities: 27,
          indexedFiles: 316,
          hubs: [
            { id: 'lib_db_client', label: 'DbClient', degree: 214, file: 'src/lib/db/client.ts' },
            { id: 'lib_cart_store', label: 'CartStore', degree: 168, file: 'src/lib/cart/store.ts' },
            { id: 'components_product_card', label: 'ProductCard', degree: 141, file: 'src/components/ProductCard.tsx' },
            { id: 'lib_checkout_session', label: 'CheckoutSession', degree: 97, file: 'src/lib/checkout/session.ts' },
            { id: 'lib_auth_session', label: 'AuthSession', degree: 64, file: 'src/lib/auth/session.ts' },
            { id: 'lib_search_index', label: 'SearchIndex', degree: 38, file: 'src/lib/search/index.ts' }
          ],
          relations: [
            { name: 'imports', count: 3980 },
            { name: 'calls', count: 3164 },
            { name: 'contains', count: 2455 },
            { name: 'renders', count: 812 },
            { name: 'imports_from', count: 407 }
          ],
          confidence: [
            { name: 'EXTRACTED', count: 8402 },
            { name: 'INFERRED', count: 1109 },
            { name: 'AMBIGUOUS', count: 223 }
          ],
          kinds: [
            { name: 'code', count: 3711 },
            { name: 'doc', count: 471 }
          ],
          updatedAt: Date.now() - 1000 * 60 * 12,
          hasReport: true,
          hasHtml: true,
          tooLarge: false,
          sizeBytes: 6_412_880
        },
        obsidian: {
          vault: '/home/you/Documents/Vault',
          source: 'detected',
          noteExists: true,
          notePath: '/home/you/Documents/Vault/Pulse/acme-storefront.md',
          updatedAt: Date.now() - 1000 * 60 * 8,
          excerpt:
            '# acme-storefront\n\n- Version: 1.4.0\n- Last Pulse sync: 2026-08-24T21:40:00Z\n- Project path: `/home/you/projects/acme-storefront`\n- Last agent: Web Frontend Engineering\n- Last event: session-start\n\n[[Pulse Agent Council]]',
          notes: [
            { name: 'acme-storefront', path: '/home/you/Documents/Vault/Pulse/acme-storefront.md', updatedAt: Date.now() - 1000 * 60 * 8 },
            { name: 'order2', path: '/home/you/Documents/Vault/Pulse/order2.md', updatedAt: Date.now() - 1000 * 60 * 60 * 5 },
            { name: 'pulsaride', path: '/home/you/Documents/Vault/Pulse/pulsaride.md', updatedAt: Date.now() - 1000 * 60 * 60 * 30 }
          ]
        }
      }),
    history: async () =>
      ok({
        available: true,
        total: 6,
        events: [
          { ts: new Date(Date.now() - 1000 * 60 * 2).toISOString(), kind: 'item_changed', entity: 'item', itemId: 'i1', title: 'Checkout session refactor', field: 'status', old: 'wip', neu: 'done', actor: 'claude' },
          { ts: new Date(Date.now() - 1000 * 60 * 9).toISOString(), kind: 'item_changed', entity: 'item', itemId: 'i1', title: 'Checkout session refactor', field: 'verified', old: 'false', neu: 'true', actor: 'claude' },
          { ts: new Date(Date.now() - 1000 * 60 * 31).toISOString(), kind: 'item_added', entity: 'item', itemId: 'i2', title: 'Rate-limit the search endpoint', field: '', old: '', neu: 'wip', actor: 'codex' },
          { ts: new Date(Date.now() - 1000 * 60 * 60).toISOString(), kind: 'item_changed', entity: 'item', itemId: 'i3', title: 'Cart totals off by a cent', field: 'status', old: 'todo', neu: 'broken', actor: 'you' },
          { ts: new Date(Date.now() - 1000 * 60 * 95).toISOString(), kind: 'fix_added', entity: 'fix', itemId: 'f1', title: 'Rounding in tax calc', field: '', old: '', neu: 'open', actor: 'gemini' },
          { ts: new Date(Date.now() - 1000 * 60 * 140).toISOString(), kind: 'version_changed', entity: 'project', itemId: '', title: 'version', field: 'version', old: '0.3.1', neu: '0.4.0', actor: 'you' }
        ]
      }),
    onBoardChanged: () => () => {},
    // Git and backups are real subprocess/filesystem work in the app; here they
    // are plausible answers so the two tabs can be looked at.
    gitStatus: async () =>
      ok({
        ok: true, has_git: true, path: PATH, branch: 'main', dirty: true, changed_count: 3,
        remote: 'git@github.com:you/acme-storefront.git', ahead: 2, behind: 0,
        last_commit: 'search: keep filters in the URL so results are shareable'
      }),
    gitInit: async () => ok({ ok: true, message: 'initialised git repo on main' }),
    gitSetRemote: async (_p: string, url: string) => ok({ ok: true, remote: url }),
    gitLargeFiles: async () =>
      ok({
        ok: true, threshold_mb: 25, count: 3,
        files: [
          { path: 'public/video/hero-loop.mp4', size_mb: 128.4, ext: '.mp4' },
          { path: 'design/storefront-2026.fig', size_mb: 61.2, ext: '.fig' },
          { path: 'public/img/lookbook-master.psd', size_mb: 34.8, ext: '.psd' }
        ],
        extensions: ['.mp4', '.fig', '.psd']
      }),
    gitLfs: async (_p: string, patterns: string[]) => ok({ ok: true, installed: true, tracked: patterns }),
    gitSync: async () =>
      ok({
        ok: true, committed: true, pushed: true, branch: 'main', push_error: '',
        log: ['staged 3 files', 'committed: PlanIDE: sync tracker + project state', 'pushed to origin/main']
      }),
    backupList: async () =>
      ok([
        { file: 'acme-storefront-v1.4.0-before_checkout_rewrite-20260820-061500.zip', size: 24_100_000, size_mb: 24.1, created_at: '2026-08-20 06:15' },
        { file: 'acme-storefront-v1.3.4-20260818-224000.zip', size: 23_600_000, size_mb: 23.6, created_at: '2026-08-18 22:40' }
      ]),
    backupCreate: async () => ok({ ok: true, file: 'acme-storefront-v1.4.0-20260820-093000.zip', files: 812, size_mb: 24.3 }),
    backupDelete: async () => ok({ ok: true }),
    gitAutoPush: async (_p: string, enabled: boolean) => {
      state.github = { ...state.github, auto_push: enabled }
      store.logActivity(state, 'auto-push', enabled ? 'auto-push on' : 'auto-push off')
      return ok(rollups())
    },
    addFix: async (_p: string, o: { title: string; problem?: string }) => after(store.addFix(state, o)),
    addVersion2: async () => ok(rollups())
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
