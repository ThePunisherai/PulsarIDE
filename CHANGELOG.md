# Changelog

What each version actually gives you. Newest first.

PlanIDE is [Orca](https://github.com/stablyai/orca) with a project tracker built
into it — the same parallel-agent IDE, plus a board that knows what works, what
is broken, what must not be touched, and what the agents have been doing.

## [0.14.0] - 2026-08-21

### Fixed
- **"Orca" is gone from the interface.** The rebrand reached the locale catalogs,
  but Orca's English UI uses inline fallbacks and raw strings that never live in
  those catalogs — so the app still showed **"ORCA"** on the welcome screen, in
  the title bar, and across dialogs, skills and error messages. PulsarIDE now
  rebrands the product name inside the app's own source strings too (442 files),
  leaving code, comments, lowercase `orca` commands, compound identifiers and
  Stably's real external services (Orca Cloud/Relay/CLI) untouched. Verified
  against Orca's own full typecheck (exit 0) on a clean upstream checkout.

### Added
- **The agent keeps the tracker in sync with the chat, automatically.** The
  built-in tracker instruction — carried by every team lead and injected into the
  main session at start, only for projects you already track — now spells out the
  behaviour: mark an item `works` when you get it working, `broken` when you hit a
  bug, `mark_fixed` when you (the user) say something is solved, and **update the
  board before saying "done" or "please test"**. It records the agent's *claim*
  (shown amber until you confirm it); it never auto-greens the board.

### Notes
- The app icon has been the pulsar in every build since v0.11.0 — the installer
  and the executable both embed it, and the window/dock icon uses it too. If
  Windows still shows the old icon after updating, that is Windows' own icon
  cache; a fresh install (or clearing the icon cache) resolves it.
- Board updates are instruction-driven, so they depend on the agent following the
  instruction. The Activity trail is the code-guaranteed half: every finished
  agent turn is recorded automatically, even for an agent that never calls a tool.

## [0.13.0] - 2026-08-21

### Added
- **Agents keep the tracker updated.** The built-in project tracker — the `plan`
  CLI, the `planide` package and the `planide` MCP server — now ships inside the
  app and deploys on launch. The MCP server is registered at Claude Code **user
  scope**, so an agent in **any** project can read the board and record what it
  builds, fixes or breaks (`get_board`, `add_item`/`set_item`,
  `add_fix`/`mark_fixed`, `add_version`), and the IDE's Tracker tab reflects it
  live. Every deployed team lead now carries that instruction, and the
  SessionStart hook reminds the main session too — but only for a project you
  already track (a repo with no `.planide/state.json` is never nudged or
  littered).

### Notes
- Two channels, on purpose. Agents *actively* update the board via the MCP tools
  or the `plan` CLI, and every finished agent turn is *passively* recorded to the
  project's Activity trail — so the trail is complete even for an agent that
  never calls a tool. The board still only shows what an agent explicitly
  reports; nothing is auto-greened, and the `verified`/`locked` flags stay yours.
- Graphify + Obsidian stay per project and automatic: the SessionStart hook runs
  the knowledge-graph bootstrap and writes each project's own Obsidian note
  (vault auto-detected), with durable per-project receipts kept outside the repo.
- The `planide` MCP server needs Python's `mcp` package to start; without it the
  `plan` CLI (pure stdlib) still lets agents update the board, so the tracker is
  never dead. The registration only ever touches its own `planide` key in
  `~/.claude.json` and preserves everything else.

## [0.12.0] - 2026-08-20

### Added
- **ThePunisher's agents, pre-installed.** PulsarIDE now ships the 101 team-lead
  subagents and 48 curated skills from ThePunisher-Agent inside the app, and
  deploys them on first launch to the shared agent locations — so Claude Code,
  Codex and Gemini running inside the IDE have the whole roster in **every
  project**, with no dashboard and no separate install.
- **Orchestration by default.** The `agent-orchestrator` and `dispatch`
  (cross-tool delegation) skills are part of the default set.
- **Graphify + Obsidian, per project.** A SessionStart hook runs the knowledge-
  graph bootstrap and the Obsidian note-writer (vault auto-detected) once per
  project, wired into Claude Code on Linux/macOS and its PowerShell twin on
  Windows.

### Notes
- Only the 101 team leads deploy as native subagents — never the 5,050
  specialists, which would blow Claude Code's agent-description budget. A team
  lead reads and adopts a specialist on demand.
- The deploy is version-gated (a normal launch pays nothing), reconcile-not-
  accumulate, and never touches an agent, skill or hook you configured yourself.

## [0.11.0] - 2026-08-20

### Changed
- **The IDE is now PulsarIDE**, with a new pulsar icon — a neutron-star core with
  twin beams and pulse rings, on the window, dock, taskbar and installer.
- The remaining places the app called itself "Orca" now say PulsarIDE: onboarding,
  the crash and error dialogs, the menu bar, the tray, update notices, browser
  warnings. 1,879 identity strings across five languages.

### Note
- Orca's own external services keep their real names on purpose — Orca Cloud,
  Orca Relay, the mobile companion, account sign-in, the `orca` CLI, and the
  GitHub star link. Renaming those would point you at things that do not exist
  under the PulsarIDE name. 879 such strings were left exactly as upstream ships
  them.

## [0.10.0] - 2026-08-20

### Added
- **GitHub tab.** The branch and what is uncommitted, ahead/behind, the remote
  (or a field to set one). A scan for files over 25 MB — the ones GitHub rejects
  at 100 and warns about at 50 — with sizes, and one button to hand those
  extensions to Git LFS. Then commit and push, with the log it produced.
- **Backups tab.** Take a zip snapshot before letting an agent near something
  load-bearing, see what you already have, delete what you do not need. The
  tracker state ships inside the zip, so the board travels with the code.
- **Push by itself.** A switch on the GitHub tab: a change to the board arms a
  90-second timer, each new change re-arms it, and the push lands once things go
  quiet — one commit per work session, not one per keystroke. Off unless you
  turn it on, and every attempt lands in Activity, so a failure is not silent.
- **Log a fix** and **cut a version** buttons — both were engine calls that no
  button reached.

### Changed
- Quick capture now only appears on the board, where it means something.

## [0.9.1] - 2026-08-20

### Fixed
- Deep links. Orca handles `orca://skills/share/<id>`; renaming the app's
  protocol would have left those with nowhere to go. Both schemes are registered
  now, and the parser is untouched.
- The right-sidebar tab and the left nav were still drawing a stock radar icon
  instead of the PlanIDE mark.
- The overlay's apply test ran against a checkout the build script had already
  patched, so it could pass on anchors an earlier run had created. It tests
  against pristine upstream now.

### Added
- `ide/check-additive.py`, run in every self-test: the overlay adds to Orca and
  must not take anything away. Only the branding constants may rewrite a line.

## [0.9.0] - 2026-08-20

### Added
- A design pass on both surfaces, in Orca's own vocabulary: a header with the
  mark and a ring showing confirmed against claimed, compact stat tiles, board
  columns that carry their status colour, and an activity trail where a
  regression is loud and an agent's own words are in italics.
- The PlanIDE mark, everywhere it shows: the nav, the sidebar tab, the window,
  the dock, the taskbar and the installer — generated from one SVG.

## [0.8.0] - 2026-08-19

### Added
- Agent turns are recorded automatically, straight from Orca's own agent hooks:
  every finished turn lands in Activity under the agent's name, including agents
  that never call the CLI or MCP. It never touches the board — a finished turn
  is not evidence that anything works.

## [0.7.0] - 2026-08-19

### Changed
- The tracker became part of the IDE rather than a service beside it: no server,
  no port, no extra runtime. Main-process TypeScript over IPC, which also
  removed a whole class of origin problems.

## [0.6.0] - 2026-08-18

### Added
- The whole tracker as a top-level page in the IDE, next to Orca's own: board,
  protected work, fixes, roadmap, versions, activity and the AI briefing.

## [0.5.0] - 2026-08-18

### Added
- Your own board: mark work **do not break**, and see a regression the moment a
  protected item fails.
- Claimed against confirmed, tracked as two different things — an agent saying
  "works" is a claim, and only you can confirm it.
