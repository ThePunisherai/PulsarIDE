# Changelog

What each version actually gives you. Newest first.

PlanIDE is [Orca](https://github.com/stablyai/orca) with a project tracker built
into it — the same parallel-agent IDE, plus a board that knows what works, what
is broken, what must not be touched, and what the agents have been doing.

## [0.28.1] - 2026-08-26

### Fixed
- **v0.28.0 produced no installers.** The build failed on a bad import path and
  a few unused imports in the new memory panel. Everything v0.28.0 describes is
  in this release — that one just had nothing you could download.
- **The local checks now catch this class before CI does.** A new component
  could be left out of the typecheck entirely and nobody would notice, and the
  check was not enforcing unused-import errors the way the real build does.
  Both are fixed, and a new guard fails the suite if a component is ever left
  untypechecked again.

## [0.28.0] - 2026-08-26

### Fixed
- **PulsarIDE no longer shares a home directory with Orca.** Orca deliberately
  shares `~/.orca` between its own instances, so running both meant both wrote
  the same agent-hook launchers and whichever started last owned every agent's
  hooks. That is the "it mixes with Orca" problem, and a good reason subagents
  from one of them went unseen. Hook launchers, the install lock, the Claude
  agent-teams shim and relay sessions now live under `~/.pulsar`. Logins stay
  shared on purpose — one Jira or Linear sign-in for both is a feature.
- **The tracker's scrollbars.** Orca ships a slim VS Code-style scrollbar and
  the tracker page simply never used it, so it fell back to the chunky OS one.

### Changed
- **Brain Graph and Obsidian are their own sidebar tabs**, under Tracker,
  instead of tabs inside the tracker. They are memory, not the board — you want
  them open while you work rather than by leaving the board.
- **Refresh re-scans instead of just re-reading.** The board already updates
  itself, so re-reading had nothing to show. It now re-runs project detection
  too, picking up a language or dependency added since you opened it.

## [0.27.0] - 2026-08-25

### Fixed
- **The IDE could wipe your Claude settings, taking Orca's subagents with it.**
  `~/.claude/settings.json` is shared — Claude Code keeps your env and
  permissions there, and Orca installs the hooks its orchestrator drives
  Claude/Codex subagents through. If PulsarIDE could not parse that file for any
  reason, it replaced it with an empty one. That deleted Orca's hooks, which is
  exactly why subagents launched from the IDE stopped working. It now leaves a
  file it cannot read completely alone.
- **Config writes can no longer leave a half-written file.** Every shared config
  we touch is written to a temp file and renamed, so a crash or a reader landing
  mid-write can never produce the truncated settings.json an agent CLI refuses
  to load.

### Changed
- **The theme reaches the rest of the IDE, not just its colours.** Corner radius
  is tighter across every card, button, input and dialog, and errors now use the
  palette's own red instead of a borrowed one.

## [0.26.0] - 2026-08-25

### Fixed
- **Subagents stopped working if you also run ThePunisher-Agent.** PulsarIDE
  ships that same roster, so both installs put the same 100 team leads in the
  same folder under different names — and two rosters cost about 21k tokens
  against the ~15k Claude Code allows for agent descriptions. Over the limit,
  agents stop loading. PulsarIDE now notices the roster is already there and
  does not add a second copy. Your other install is left exactly as it is, and
  the board instructions still reach every session.

## [0.25.0] - 2026-08-25

### Added
- **Pulse Agent now reaches every agent in the IDE.** Antigravity gets its own
  native Skill instead of only seeing the shared GEMINI.md, and Cursor — which
  had the tracker but no persona at all — gets an always-applied rule. Claude
  Code, Codex and Gemini CLI are unchanged.

### Changed
- **README brought back in line with the app.** It still described 101 agents, a
  `pip install` for the MCP that no longer exists, and an overlay of 38 edits.
  It now says what actually ships — including Brain Graph, Obsidian, the live
  board, the theme and self-updating, none of which it mentioned.

## [0.24.0] - 2026-08-25

### Added
- **A theme of our own.** The IDE no longer wears Orca's grey. Deep blue-black,
  with the two beams from the logo — blue and violet — running through buttons,
  focus rings, charts and the sidebar. Light mode gets the same identity in
  daylight. Nothing upstream was edited: it re-declares the same design tokens.

### Fixed
- **Refresh now shows it did something.** It always re-read the board — but a
  refresh that found nothing new changed nothing on screen, so the button looked
  dead. It spins while it works now, and the tracker says when it last updated.
  Same fix in the sidebar.
- **Cards stopped being walls of text.** An agent writing fifteen lines of notes
  turned one card into a full column. Titles and notes are clamped now; the full
  text is still there on hover and when you open the card.
- **The board uses the space it has.** Cards no longer reserve room for buttons
  you cannot see, columns are wider, and the page is no longer squeezed into a
  1152px reading column, so a six-column board is not cut off at the edge.

## [0.23.0] - 2026-08-25

### Changed
- **Up to date with the latest Orca.** 182 upstream commits since the last bump,
  including their split of several big files into smaller modules. Everything
  PulsarIDE adds still applies cleanly on top, and Orca's own full typecheck
  passes — checked by actually building it here, not by assuming.

### Fixed
- **A rebase landmine, before it went off.** Upstream reflowed the import our
  tracker hooks into, which would have broken the next update. The tracker's
  four imports now go in as one block anchored on a line upstream leaves alone,
  instead of each one hanging off the one before it — a chain where any upstream
  edit in the middle could snap the whole thing, and which had already broken
  re-running the build once before.

## [0.22.0] - 2026-08-24

### Fixed
- **The agent can create a roadmap again.** The tool for it was missing from the
  tracker's tool set, so the Roadmap tab could only ever stay empty no matter
  what you asked for. Milestones can now be added and closed.
- **Finished work reaches Complete.** Everything piled up in "Works" because
  nothing said what the difference was. "Works" now means it functions but is
  still in play; "Complete" means closed out — and the agent is told which is
  which.
- **The board updates itself.** The tracker watches the project and refreshes the
  moment an agent writes to it, in both the sidebar and the full page. No more
  pressing Refresh and wondering.

### Changed
- **The agent is now "Pulse Agent".** Every team lead announces itself as
  `🔴 Pulse Agent — <team>`, and notes are written under `Pulse/` in your vault.
- **The board is a proper kanban.** It was a 3×2 grid, so a real project with
  nothing broken showed tall empty boxes saying "nothing here" while the columns
  you cared about were pushed onto a second row. Now it is one row that scrolls,
  and an empty column shrinks to a thin marker instead of a hole.

### Added
- **Brain Graph tab** — what the project's knowledge graph actually contains:
  size, the pieces everything hangs off, how things relate, and how much was read
  straight from the code versus inferred.
- **Obsidian tab** — the vault, this project's note with a preview, and every
  project the agent has remembered.

## [0.21.0] - 2026-08-22

### Added
- **PulsarIDE updates itself now.** The app checks your own releases and installs
  new versions in the background — the same updater Orca ships, pointed at
  PulsarIDE instead of Orca, so you get a tested mechanism rather than a new one.
  Each release now also publishes the update manifest the updater needs.
- **The app reports its own version.** It used to report Orca's (1.4.178-rc.2)
  while releases were tagged 0.x — the updater read every release as a downgrade
  and would never have offered one. It now uses PulsarIDE's version.

### Changed
- **Updated to the latest Orca** (2026-08-21), so PulsarIDE keeps up with
  upstream's fixes. All 46 overlay edits still apply cleanly.

### Fixed
- **Linux builds stopped dying halfway.** The build runs three typecheckers at
  once, each allowed a 4 GB heap, which could exhaust the build machine and kill
  it mid-run. Capped so they fit.

### Note
- Auto-update takes over **after** you install this version once by hand: an
  older install still reports Orca's version number, so it cannot recognise 0.21.0
  as newer. From 0.21.0 onward it is automatic.

## [0.20.0] - 2026-08-22

### Fixed
- **The tracker actually tracks now.** Two separate bugs meant nothing ever
  reached the board, in any agent:
  - The MCP server agents call needed **Python plus `fastmcp`** — without them it
    exited on startup, so the agent had no tracker tools at all and the board
    could never move. It is now a **zero-dependency Node server that runs on the
    IDE's own binary**: nothing to install, and it cannot be broken by your
    Python. Claude, Codex, Cursor and Gemini/Antigravity all get it.
  - The automatic activity trail only recorded in a project that **already had**
    a board, so a project you had not opened the Tracker tab in recorded nothing,
    ever. **The board now starts itself** on the first turn an agent finishes.
- **Keeping the board current is now step 2 of every task**, before any code —
  read the board, then put the request on it — instead of a note further down the
  instructions that was easy to skip. That is what the Council now does by default.

## [0.19.0] - 2026-08-22

### Fixed
- **The last of the Orca logo is gone.** The in-app logo (`resources/logo.svg`,
  shown on the landing screen, the title bar, onboarding and settings) and both
  app/dock icons were still Orca's — the overlay had never replaced them. They
  are now a Pulsar mark: a neutron-star core with two relativistic beams. No
  Orca artwork remains anywhere in the UI.

### Changed
- **The built-in agent is now "Pulsar", not "ThePunisher".** Every team lead's
  activation banner now reads `🔴 Pulsar — <team>`, and the persona, the
  main-session orchestration block and the Obsidian notes all say Pulsar. The
  100 team leads are registered as `pulsar-*` (so `@pulsar-council`, etc.), and
  per-project notes are written under `<vault>/Pulsar/`.

### Added
- **The tracker now reaches every agent, including Gemini and Antigravity.** The
  `planide` tracker MCP is registered for Gemini CLI / Antigravity in
  `~/.gemini/settings.json` too — alongside Claude Code, Codex and Cursor — so a
  session in any of them can read and update the board live. Existing settings in
  that file are preserved; only the `planide` entry is added.
- **A "Memory" tab in the tracker.** It shows, for the project in front of you,
  whether graphify's knowledge graph is built (node/edge counts, freshness,
  report/HTML present) and whether its Obsidian note exists — the same graph and
  note the per-project hooks write. So you can *see* graphify and Obsidian
  working for a project, instead of trusting a background hook ran.

## [0.18.0] - 2026-08-21

### Added
- **Multi-account overview in the tracker.** The Activity tab now leads with
  "Agent work by account" — each AI account (Claude, Codex, Gemini …) that did
  work in the project, with its turn count, last-active time and a usage bar. So
  you can see at a glance which account has been doing what, across the session.

## [0.17.0] - 2026-08-21

### Added
- **graphify + Obsidian now run per workspace for every agent, from the IDE
  itself** — not only through Claude Code's SessionStart hook. The moment any
  agent (Codex, Cursor, Claude) does work in a workspace, the IDE runs the
  knowledge-graph + Obsidian sync for that project (throttled 6h, detached), so a
  project opened in Codex gets its `graphify-out/graph.json` and Obsidian note
  automatically — not just Claude projects.
- **The reverse-engineering toolkit ships inside the IDE.** `re-triage.sh`, the
  Ghidra/Frida/x64dbg drivers, `fuzz-driver.sh` and `linux-unpack.sh` deploy to
  `~/.config/pulsaride/tools/` and are named in the agent's main-session
  instructions.

### Notes
- The full 2,554-skill vendored library is deliberately NOT bundled into the
  installer: its security/pentest content flags the installer as a virus in
  Windows Defender (the same problem ThePunisher's own exe hit), and deploying
  thousands of skill descriptions blows Claude Code's context budget. The 48
  curated skills deploy, and the 100 team leads route to all 5,050 named
  specialists on demand — so the capability is there without the risk.

## [0.16.0] - 2026-08-21

### Fixed
- **The tracker now works in Codex and Cursor, not just Claude Code.** The
  planide MCP and its instruction were only ever registered for Claude Code — so
  a project run in Codex never got them and the board stayed empty. The MCP is now
  registered in `~/.codex/config.toml` (`[mcp_servers.planide]`) and
  `~/.cursor/mcp.json`, and the instruction is merged into each tool's
  always-loaded memory (`~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`,
  `~/.gemini/GEMINI.md`) so the *main* session uses the board without an
  @-mention. The generated Codex TOML is verified to parse and to preserve your
  existing config.
- **The Tracker sidebar tab opened nothing when clicked.** It was typed, rendered
  and persistence-guarded, but the route normalizer's runtime allowlist never
  included `planide`, so every click snapped back to Explorer. Fixed.
- **Codex subagents suddenly stopped working.** The bundle's own `README.md` was
  being deployed as an agent (no `name:`, empty description) into
  `~/.codex/agents/` — one malformed agent can make Codex reject the whole set.
  The deploy now ships only real agents (100 team leads). Also hardened the Codex
  TOML generation to use a literal string for instructions, so a persona body
  with a regex/hex/Windows path (backslashes) can never break the parse.

### Added
- **The Council asks first.** Every main session now starts with the Council's
  understand-first rule — restate the request, ask one clarifying question when it
  is genuinely ambiguous, then route — before diving in.

## [0.15.0] - 2026-08-21

### Added
- **graphify and the tracker MCP are now truly pre-built — no dashboard, no
  manual `pip install`.** On first launch the IDE provisions its own isolated
  Python venv (`~/.config/pulsaride/pyenv`) with graphify + fastmcp, in the
  background, without touching your system Python. The knowledge-graph memory and
  the `planide` MCP server then just work: the SessionStart hook finds the venv's
  graphify even when it's off-PATH, and the MCP re-points at the venv's python the
  moment it's ready. If Python is missing or offline it degrades gracefully — the
  `plan` CLI (pure stdlib) still runs and the memory sync still writes Data + the
  Obsidian note.
- **The agent creates `todo` items too.** The tracker instruction now covers the
  whole lifecycle: when you ask for something (or the agent plans a step) it adds
  a `todo` first, moves it to `wip` when work starts, then `works`/`broken` — kept
  in sync per project.

### Fixed
- **`pip install mcp` no longer breaks the tracker MCP.** The `mcp` SDK's 2.0
  release moved FastMCP into a standalone `fastmcp` package, so the server's old
  `from mcp.server.fastmcp import FastMCP` failed on the current SDK. It now
  accepts either (standalone `fastmcp` first), and the bundled venv installs it.

### Notes
- Fully pre-built, no dashboard: the 101 agents + 48 skills + orchestration, the
  tracker board, the per-project Obsidian note, and now graphify + the MCP all
  deploy or provision on launch. The one external app is Obsidian itself — its
  vault is auto-detected; graphify and fastmcp the IDE provisions for you.

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
