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

## What the overlay changes (25 edits, 20 files added)

### Branding
| File | Change |
|---|---|
| `src/main/startup/dev-instance-identity.ts` | `BASE_APP_NAME` → `PlanIDE`, AppUserModelID → `com.thepunisher.planide` |
| `config/electron-builder.config.cjs` | `appId`, `productName`, deep-link scheme `planide://`, executable names |
| `package.json` | `name`, `description` |
| **added** `resources/icon.png`, `icon-dev.png` | the running app's window/dock icon (dev build gets the amber variant) |
| **added** `resources/build/icon.{png,ico,icns}` | the packaged app and its installers |

### The tracker workbench (full page)
| File | Change |
|---|---|
| `src/shared/ui-chrome-types.ts` | adds `'planide'` to `TopLevelView` |
| `src/shared/top-level-view.ts` | allows it through the persistence guard |
| `AppWorkspaceShell.tsx` | lazy-imports and renders the page |
| `SidebarNav.tsx` | a **Tracker** entry (radar icon) in the left nav |
| **added** `components/planide/PlanIdeView.tsx` | the workbench: quick capture, board, Protected, Fixes, Roadmap, Versions, Activity, AI briefing |
| **added** `components/planide/PlanIdeMark.tsx` | the PlanIDE glyph (currentColor, lucide's grid) and the full badge |
| **added** `components/planide/PlanIdeSync.tsx` | GitHub: repo state, large-file scan, LFS, commit + push, auto-push |
| **added** `components/planide/PlanIdeBackups.tsx` | snapshots: take one, see what you have, delete |

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
| **added** `src/main/planide/auto-push.ts` | the debounced commit + push behind the auto-push switch |
| **added** `src/preload/planide.ts` | exposes `window.api.planide` |
| `src/preload/index.ts` | wires that bridge into the `api` object |

## What stays untouched

Everything Orca does, it still does — parallel worktrees, terminal splits, Design
Mode, the GitHub/Linear integration, SSH worktrees, AI diff annotation, dragging
files to agents, the CLI, and the mobile companion. The tracker is one more page
and one more sidebar tab, next to them.

That is checked rather than asserted, and `ide/check-additive.py` keeps it that
way — it fails the suite if any edit ever drops a line of upstream code outside
the branding constants:

| | |
|---|---|
| 12 files added | none of them exist upstream (verified against the pinned revision) |
| 5 files replaced | `resources/icon*.png`, `resources/build/icon.{png,ico,icns}` — images, not code |
| 18 edits add only | the upstream line is kept verbatim inside the replacement |
| 7 edits rewrite a line | all of them branding constants: app name, AppUserModelID, appId, productName, protocol, executable names |
| 0 edits remove anything else | enforced by `check-additive.py` in every run |

**Deep links keep working.** The one thing the branding rename could have broken:
Orca handles `orca://skills/share/<id>` links, and `src/shared/skill-share-link.ts`
matches that scheme literally. Renaming the app's protocol to `planide://` would
have left those links with nowhere to go, so the overlay registers **both**
(`schemes: ['planide', 'orca']`) and never touches the parser. Mobile pairing was
never at risk for the same reason in reverse — `orca://pair?code=…` is handled by
the phone app, not the desktop, and nothing in the overlay goes near it. The
trade-off, stated plainly: with real Orca installed alongside, the OS decides
which app answers an `orca://` link.

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

**The engine had a whole half with no face.** Git status, init, remote, the
large-file scan, LFS tracking, commit and push, and zip snapshots were all
implemented and tested from the first version — reachable only from the CLI. The
**GitHub** and **Backups** tabs are that half, made usable: see the branch and
what is uncommitted, find the files GitHub will reject before it rejects them,
hand those to LFS, push, and take a snapshot before letting an agent near
something load-bearing.

**Auto-push is debounced on purpose.** `github.auto_push` and `github.last_sync`
had been in the state format since the beginning, read by nothing. They are the
switch now: a change to the tracker arms a 90-second timer, each new change
re-arms it, and the push happens once things go quiet — one commit per work
session rather than one per keystroke. Every mutation already funnels through
`mutate()` in `ipc.ts`, so that is the only place it needed wiring. It is off
unless you turn it on, it re-checks the switch when the timer fires (you may
have turned it off while it was armed), and it can never throw into the IPC call
that triggered it — a failure is written to the Activity trail instead of
disappearing. The decision logic lives in `auto-push.ts` with the git call
injectable, which is how the suite tests "three changes push once" without a
network.

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

**The design borrows Orca's, deliberately.** Every colour is one of Orca's own
tokens (`bg-card`, `text-muted-foreground`, `border-border`, `bg-accent`), so the
tracker follows the user's theme — light, dark, and any future one — without a
single global style of its own. Row actions hide until hover through Orca's own
`can-hover:` variant, the same mechanism its sidebar rows use, which also keeps
them visible on touch. Nothing here overrides an upstream component or
stylesheet; if the overlay were removed, Orca would be exactly as it was.

**The mark, in two forms.** `PlanIdeMark` is the glyph on lucide's 24×24 stroke
grid in `currentColor`, so in the nav and the activity bar it inherits the exact
active/inactive colours those places apply — Orca has this pattern itself, for
its one non-lucide tab icon. `PlanIdeLogo` is the full badge, for a logo slot.
The app icons are generated from the same `assets/icon.svg` by
`ide/design/make-icons.mjs`: Chromium rasterises the SVG, and the ICO/ICNS
containers are written by hand (no image library is installed here, and both
formats are thin wrappers around PNGs). Both are re-parsed afterwards rather than
trusted — chunk types, offsets and pixel sizes all checked.

**The design is looked at, not guessed at.** `ide/design/render.mjs` bundles the
real components — plus the real engine client and the real main-process store,
with only fs/path/crypto shimmed in memory — compiles Orca's own `main.css` for
the tokens, and screenshots every tab in both themes in headless Chromium. A
console error fails the run. The README screenshots come out of the same script.

**Failure is contained.** Every IPC handler returns `{ok, error}` rather than
throwing, and the surfaces render an error state with a retry — a tracker
problem must never take a renderer down with it.

## Verified vs. not

**Verified here** (`./verify.sh`, 29 checks):

- the overlay applies cleanly to **pristine** upstream at the pinned revision
  (`ide/fetch-upstream.sh` pulls the dozen files it touches, so this can never
  pass on an anchor an earlier run of our own created), all 25 edits resolving,
  and re-running changes nothing;
- no edit removes upstream code outside the branding constants
  (`ide/check-additive.py`, run every time);
- the tracker's own behaviour, run for real (56 checks): detection, state
  round-trips, the trust boundary, progress arithmetic, activity attribution,
  briefing ordering, snapshots, and the agent-turn recorder (completions,
  replays, session boundaries, duplicates, untracked projects), and auto-push
  (off by default, three changes pushing once, cancelled when switched off,
  re-checked at fire time, and a failed push reported rather than swallowed);
- every added TypeScript/TSX source typechecks clean twice: dependency-free in
  the default suite, and — when the design harness is installed — against real
  `@types/react`, lucide, radix and Orca's own `Button`, which is the run that
  actually proves the surfaces are type-correct (the dependency-free pass cannot see
  React's own types, so it reports `key` and callback-parameter false positives
  that the real-types run confirms are not errors);
- the call the overlay inserts into Orca's hook listener typechecks against
  Orca's *real* `AgentHookEventPayload` — with a deliberate negative control in
  the same file, so a pass cannot come from types silently failing to resolve;
- every overlay source file is listed in `OVERLAY_FILES` — the check that
  catches a new module that would never be copied into the checkout, which is
  a broken build rather than a missing feature;
- the patched `electron-builder.config.cjs` and `package.json` still parse;
- the hand-written ZIP opens cleanly in Python's `zipfile` and in the system
  `unzip`, with contents round-tripping;
- the state format is compatible in both directions between the IDE's tracker
  and the Python agent tools;
- both surfaces were rendered for real against the actual main-process store
  (React + Orca's own compiled stylesheet, filesystem shimmed in memory) and
  screenshotted in light and dark across every tab, with zero console errors;
- the generated `.ico` and `.icns` were re-parsed chunk by chunk: 7 ICO entries
  and 11 ICNS chunks, every payload a real PNG at the size its header claims;
- `@custom-variant can-hover` is still defined upstream — the surfaces hide row
  actions with it, so its removal would make controls invisible rather than
  merely ugly.

**Not verified here — needs a desktop run.** This environment has no display and
cannot install an Electron toolchain of this size, so the following are sound by
construction and review but not observed running: the packaged Electron build,
the two surfaces rendering inside a real Electron window (they were rendered in
headless Chromium instead), and the macOS/Windows installer artifacts. `./ide/build.sh --run` on a desktop is the next step.

## Upstream

Pinned at `79be5b7fde1a78bf5aca52999167b55d2d72ffdf` (Orca v1.4.178-rc.2,
2026-08-18). To move: bump `PINNED_COMMIT` in `ide/apply.py`, run
`./ide/build.sh`, and let `./ide/verify.sh` tell you whether any anchor drifted.
