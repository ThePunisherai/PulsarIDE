# How PlanIDE is built on Orca

PlanIDE is [stablyai/orca](https://github.com/stablyai/orca) (MIT) rebranded and
extended with a native project tracker. This documents exactly what is changed,
why it is done as an overlay, and what is verified versus what still needs a
desktop run.

## The overlay model

`ide/apply.py` turns an Orca checkout into PlanIDE. It does two things:

1. **Branding** — the app becomes PlanIDE end to end.
2. **Integration** — the tracker becomes a top-level **Tracker** page *and* a
   right-sidebar tab, both backed by main-process code. No server, no port, no
   extra runtime: the tracker reads and writes each project's own
   `.planide/state.json` directly and is called over IPC.

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

## What the overlay changes (25 edits, 11 files added)

### Branding
| File | Change |
|---|---|
| `src/main/startup/dev-instance-identity.ts` | `BASE_APP_NAME` → `PlanIDE`, AppUserModelID → `com.thepunisher.planide` |
| `config/electron-builder.config.cjs` | `appId`, `productName`, deep-link scheme `planide://`, executable names |
| `package.json` | `name`, `description` |

### The tracker workbench (full page)
| File | Change |
|---|---|
| `src/shared/ui-chrome-types.ts` | adds `'planide'` to `TopLevelView` |
| `src/shared/top-level-view.ts` | allows it through the persistence guard |
| `AppWorkspaceShell.tsx` | lazy-imports and renders the page |
| `SidebarNav.tsx` | a **Tracker** entry (radar icon) in the left nav |
| **added** `components/planide/PlanIdeView.tsx` | the workbench: quick capture, board, Protected, Fixes, Roadmap, Versions, Activity, AI briefing |

### The tracker panel (sidebar)
| File | Change |
|---|---|
| `src/shared/ui-chrome-types.ts` | adds `'planide'` to the `RightSidebarTab` union |
| `use-right-sidebar-activity-items.ts` | adds the radar-icon tab to the activity bar |
| `right-sidebar-panel-content.tsx` | lazy-imports and renders `PlanIdePanel` |
| **added** `PlanIdePanel.tsx` | the panel: board, open fixes, progress, status cycling, AI-briefing copy |
| **added** `planide-engine-client.ts` | typed client over the IPC bridge |

### The tracker (main process)
| File | Change |
|---|---|
| `src/main/index.ts` | registers the tracker's IPC on `whenReady` — that is all "starting" it means |
| `src/main/index.ts` | inside Orca's own agent-hook listener, hands each finished turn to the tracker |
| **added** `src/main/planide/store.ts` | the state model: items, fixes, roadmap, versions, activity, progress |
| **added** `src/main/planide/detect.ts` | language/stack/type detection |
| **added** `src/main/planide/report.ts` | the AI briefing |
| **added** `src/main/planide/git.ts` | status, init, remote, large-file scan, LFS, commit+push |
| **added** `src/main/planide/backup.ts` | zip snapshots (own ZIP writer, no dependency) |
| **added** `src/main/planide/ipc.ts` | the typed channel surface |
| **added** `src/main/planide/agent-events.ts` | turns Orca's agent-hook events into Activity entries |
| **added** `src/preload/planide.ts` | exposes `window.api.planide` |
| `src/preload/index.ts` | wires that bridge into the `api` object |

## Design decisions worth knowing

**The tracker is part of the IDE, not something it talks to.** An earlier
revision ran it as a Python HTTP service on a loopback port, with its own web UI.
That worked, but it was a separate thing bolted alongside the IDE: another
process, another port, another runtime to install, and a CORS/CSRF problem to
design around. It is now plain main-process TypeScript called over IPC. Nothing
to start, nothing to install, and the whole class of origin problems disappears
because no HTTP is involved at any point.

**Two implementations, one file.** The IDE's tracker is TypeScript; the agent
CLI and MCP server (`agent-tools/`, for agents working in a terminal) are Python.
They share `<project>/.planide/state.json`, so that format is the contract.
`agent-tools/scripts/verify.sh` writes a state with the Python side and asserts
the TypeScript side reads it back identically — items, flags, attribution,
progress and regressions — so drift is caught by the suite rather than by a
confused user.

**The trust boundary is enforced at runtime, not by types.** `updateItem` is
reachable over IPC with arbitrary JSON, so a TypeScript signature is not a
guard. It filters through an explicit allowlist that excludes `verified` and
`locked`. This was not theoretical: the first version assigned every key it was
given, and the tracker's own test caught it — an agent could have confirmed its
own work.

**Backups use a hand-written ZIP.** Orca ships no archive library and this did
not justify a new dependency, so `backup.ts` emits the classic format (local
header + central directory + EOCD) over Node's `zlib`. The suite proves the
output is real by opening it with independent readers rather than trusting our
own writer.

**Agents are tracked by watching, not by asking.** Orca already knows when an
agent finishes a turn — that signal drives its status dots — so the tracker
listens to the same hook instead of relying on agents to report themselves. An
agent that never touches the CLI or MCP still shows up in Activity, by name.

What it deliberately does **not** do is touch the board. A finished turn is not
evidence that anything works, and a board that fills itself with green is the
exact failure this project exists to prevent, so a turn is only ever an Activity
line — promoting it to an item stays your call. It also ignores anything that
is not a real completion: replays, duplicate hook deliveries, and the `done`
that upstream marks as a session boundary (an agent connecting or being cleared,
which its own docs tell completion consumers to skip). And a workspace with no
`.planide/state.json` is left alone, so using an agent never creates tracker
files you did not ask for.

**Failure is contained.** Every IPC handler returns `{ok, error}` rather than
throwing, and the surfaces render an error state with a retry — a tracker
problem must never take a renderer down with it.

## Verified vs. not

**Verified here** (`./verify.sh`, 25 checks):

- the overlay applies cleanly to a real Orca checkout at the pinned revision,
  all 25 edits resolving, and re-running changes nothing;
- the tracker's own behaviour, run for real (46 checks): detection, state
  round-trips, the trust boundary, progress arithmetic, activity attribution,
  briefing ordering, snapshots, and the agent-turn recorder (completions,
  replays, session boundaries, duplicates, untracked projects);
- every added TypeScript/TSX source typechecks clean — including a separate
  run against real `@types/react`, which is what proves the workbench page is
  type-correct (the dependency-free `--noResolve` check in `ide/verify.sh`
  cannot see React's own types, so it reports `key` and callback-parameter
  false positives that the real-types run confirmed are not errors);
- the call the overlay inserts into Orca's hook listener typechecks against
  Orca's *real* `AgentHookEventPayload` — with a deliberate negative control in
  the same file, so a pass cannot come from types silently failing to resolve;
- the patched `electron-builder.config.cjs` and `package.json` still parse;
- the hand-written ZIP opens cleanly in Python's `zipfile` and in the system
  `unzip`, with contents round-tripping;
- the state format is compatible in both directions between the IDE's tracker
  and the Python agent tools;
- the Tracker page was rendered for real against the actual main-process store
  (React + Tailwind, filesystem shimmed in memory) and screenshotted, with zero
  console errors.

**Not verified here — needs a desktop run.** This environment has no display and
cannot install an Electron toolchain of this size, so the following are sound by
construction and review but not observed running: the packaged Electron build,
the two surfaces rendering inside a real Electron window (they were rendered in
headless Chromium instead), and the macOS/Windows installer artifacts. `./ide/build.sh --run` on a desktop is the next step.

## Upstream

Pinned at `79be5b7fde1a78bf5aca52999167b55d2d72ffdf` (Orca v1.4.178-rc.2,
2026-08-18). To move: bump `PINNED_COMMIT` in `ide/apply.py`, run
`./ide/build.sh`, and let `./ide/verify.sh` tell you whether any anchor drifted.
