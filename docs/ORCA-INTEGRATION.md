# How PlanIDE is built on Orca

PlanIDE is [stablyai/orca](https://github.com/stablyai/orca) (MIT) rebranded and
extended with a native project tracker. This documents exactly what is changed,
why it is done as an overlay, and what is verified versus what still needs a
desktop run.

## The overlay model

`ide/apply.py` turns an Orca checkout into PlanIDE. It does two things:

1. **Branding** — the app becomes PlanIDE end to end.
2. **Integration** — the tracker becomes a native right-sidebar tab, backed by
   the tracker engine started by the main process.

Nothing of upstream is vendored into this repo. `ide/build.sh` clones Orca at
`PINNED_COMMIT`, applies the overlay, and builds. Bumping upstream is a one-line
change.

**Every edit is anchored to an exact upstream string** and is:

- *verified* — an anchor that is missing or ambiguous is a hard error naming the
  file and what it was for, so upstream drift can never silently produce a
  half-patched IDE;
- *idempotent* — re-running detects already-applied edits and changes nothing.

`ide/verify.sh` re-applies the overlay to a scratch copy of the checkout on every
run, so drift is caught by the test suite rather than by a broken build.

## What the overlay changes (20 edits, 4 files added)

### Branding
| File | Change |
|---|---|
| `src/main/startup/dev-instance-identity.ts` | `BASE_APP_NAME` → `PlanIDE`, AppUserModelID → `com.thepunisher.planide` |
| `config/electron-builder.config.cjs` | `appId`, `productName`, deep-link scheme `planide://`, executable names |
| `package.json` | `name`, `description` |

### The tracker panel
| File | Change |
|---|---|
| `src/shared/ui-chrome-types.ts` | adds `'planide'` to the `RightSidebarTab` union |
| `use-right-sidebar-activity-items.ts` | adds the radar-icon tab to the activity bar |
| `right-sidebar-panel-content.tsx` | lazy-imports and renders `PlanIdePanel` |
| **added** `PlanIdePanel.tsx` | the panel: board, open fixes, progress, status cycling, AI-briefing copy |
| **added** `planide-engine-client.ts` | typed client over the IPC bridge |

### The engine
| File | Change |
|---|---|
| `src/main/index.ts` | starts the engine + registers the bridge on `whenReady`, stops it on `before-quit` |
| **added** `src/main/planide/engine-service.ts` | spawns/adopts the engine, port discovery, IPC handlers |
| **added** `src/preload/planide.ts` | exposes `window.api.planide` |
| `src/preload/index.ts` | wires that bridge into the `api` object |
| `config/electron-builder.config.cjs` | ships `tracker/` as an extraResource (kept out of `app.asar`) |

## Design decisions worth knowing

**The engine is a child process, not a TypeScript port.** The tracker already
exists as a self-tested product that also runs standalone and backs the CLI and
MCP server agents use. One source of truth beats two implementations that drift.
The IDE spawns it on a loopback port; if an engine is already running (someone
ran `tracker/start.sh`, or a second window is open) it is *adopted* rather than
duplicated — and a listener is only adopted after it answers as a PlanIDE engine
on `/api/overview`, never on the assumption that whatever holds the port is ours.

**The panel talks over IPC, not `fetch`.** This one caught a real bug during
development. An Electron renderer is a *different origin* from the engine's
loopback port — `file://` (so `Origin: null`) in a packaged build, the Vite
origin in dev. A JSON `POST` from there triggers a CORS preflight and would be
rejected by the engine's CSRF guard; "fixing" that by allowing `null` origins
would re-open exactly the cross-site hole the guard exists to close (a sandboxed
iframe on any website also sends `Origin: null`). So requests are proxied
main-side over a named IPC channel — the same pattern every other Orca feature
uses — and the guard stays strict. The bridge only forwards `/api/*` paths.

**`tracker/` ships as an extraResource.** Python executes the engine, and
nothing can be executed from inside `app.asar`, so it must remain a real
directory. A dev run symlinks it instead, so the IDE uses this repo's engine
directly.

**Failure is tolerated.** If Python is missing or the engine cannot start, the
IDE still boots and the panel shows what went wrong with a retry — the tracker
must never be able to take the IDE down.

## Verified vs. not

**Verified here** (`./verify.sh`, 31 checks):

- the overlay applies cleanly to a real Orca checkout at the pinned revision,
  all 20 edits resolving, and re-running changes nothing;
- the four added TypeScript/TSX sources have zero syntax errors, and the patched
  `electron-builder.config.cjs` and `package.json` still parse;
- every endpoint the panel calls was exercised against a live engine —
  `project/add`, `project?id=`, `item/add`, `item/update`, `fix/add`,
  `fix/update`, `ai-report` — with the exact field shapes the client types
  expect, plus the port-discovery contract on `/api/overview`;
- the engine's CSRF guard allows the bridge's requests and still rejects a
  cross-origin POST with 403.

**Not verified here — needs a desktop run.** This environment has no display and
cannot install an Electron toolchain of this size, so the following are sound by
construction and review but not observed running: the packaged Electron build,
the panel rendering inside a real Extension-host window, and the macOS/Windows
installer artifacts. `./ide/build.sh --run` on a desktop is the next step.

## Upstream

Pinned at `79be5b7fde1a78bf5aca52999167b55d2d72ffdf` (Orca v1.4.178-rc.2,
2026-08-18). To move: bump `PINNED_COMMIT` in `ide/apply.py`, run
`./ide/build.sh`, and let `./ide/verify.sh` tell you whether any anchor drifted.
