# Changelog

What each version actually gives you. Newest first.

PlanIDE is [Orca](https://github.com/stablyai/orca) with a project tracker built
into it — the same parallel-agent IDE, plus a board that knows what works, what
is broken, what must not be touched, and what the agents have been doing.

## [0.43.0] - 2026-08-29

### Added
- **Prompt Master ships with the IDE.** A prompt-engineering skill (MIT,
  nidhinjs/prompt-master) with templates for 30+ AI tools, now installed
  alongside the other skills so any agent can use it. It only activates when you
  actually ask for a prompt to be written or improved, so it stays out of the way.

## [0.42.0] - 2026-08-29

### Fixed
- **The logo inside the app matches the icon now.** The app icon was repainted
  red-on-black, but the logo the interface itself uses — landing screen, title
  bar, onboarding, settings — was never repainted with it, so it stayed
  blue-violet and clashed with the theme everywhere it appeared. The alternate
  icons under Settings had the same problem and were regenerated too.

## [0.41.0] - 2026-08-28

### Fixed
- **Your agents were told to run tools that do not exist.** Every team lead was
  instructed to call a `run_verify()` tool that was never shipped and to run
  ThePunisher-Agent's own `scripts/verify.sh` and `anti-loop.sh` — in whatever
  project you happened to be in. Those calls could only fail, and a failure then
  got recorded as a failed approach and started blocking real work. They now
  point at the tools PulsarIDE actually ships, and the build refuses to ship if
  an agent ever names one that does not exist again.
- **Refresh looks like it did something.** Reading a board takes a few
  milliseconds, so the spinner turned on and off inside one frame and pressing
  Refresh felt like pressing nothing. The icon now visibly turns on every
  refresh — the board, the sidebar, Brain Graph, Open Design, and the repository
  panel, which never spun at all.

### Changed
- **The Council runs agents side by side.** It named the right specialists and
  then worked through them one at a time, which wastes an IDE built to run
  agents in parallel. It now dispatches independent sub-tasks together and keeps
  in sequence only what truly depends on something earlier, saying which is which.

## [0.40.0] - 2026-08-28

### Fixed
- **The specialists your agents were told to read were never installed.** Since
  v0.22.0 the bundled agents, skills and the 100 specialist files only updated
  when an internal version number changed — and it never did, so an existing
  install skipped every update and agents pointed at a
  `.config\pulsaride\specialists` folder that was not on disk. That is
  where the errors and the repeated HALTs came from. PulsarIDE now decides by
  what it actually ships, so it can no longer be forgotten.
- **PulsarIDE stopped answering as "ThePunisher".** If you also ran
  ThePunisher-Agent's installer, its block sat in the file every session loads
  and told the model to sign as ThePunisher — so renaming the agent never
  reached you. PulsarIDE's own block wins now. Anything you wrote yourself is
  untouched, and re-running that installer restores its copy.
- **The anti-loop stops fighting you.** One failure blocked an approach forever,
  even after you fixed the cause, and a short note like "add a guard" blocked
  everything containing those words. It now warns on the first failure and only
  blocks on a genuine repeat, stops blocking on records older than a week, and
  there is a way to clear one once the cause is fixed.

## [0.39.0] - 2026-08-28

### Fixed
- **A forgotten project name no longer loses the update.** Every tracker tool
  asks the agent which project to write to; when an agent left that out, the
  whole write was dropped and the board never moved. It now falls back to the
  directory the agent is working in — which, for a task run from the IDE's
  terminal, is the project — so the update lands anyway. It still refuses when
  that directory is not a project, so a stray board is never created where it
  does not belong.
- **The tracker works from a terminal even when the app is closed (Linux).** A
  Linux AppImage's own path changes every launch and is gone once the app is
  closed, so an agent started from your own terminal was pointed at a runtime
  that no longer existed and its tracker tools quietly did nothing. It now uses
  a stable system Node when one is installed, so the board updates whether or
  not the app is running.
- **A refused write now says why.** When a tracker call is rejected — a bad id,
  a path that does not exist — the reason is written to the agent's log instead
  of the write simply vanishing, so an empty board can be diagnosed rather than
  guessed at.

## [0.38.0] - 2026-08-28

### Fixed
- **More agents can work at once.** PulsarIDE tracked at most 32 subagents per
  pane; past that, a newly started one was silently dropped — it kept running,
  but you could not see it. With a hundred teams to route across that ceiling
  was easy to hit. It is 128 now.

## [0.37.0] - 2026-08-28

### Changed
- **Loading looks like the thing that is loading.** Opening the Tracker now
  shows the board's own shape filling in — tiles and columns — instead of a
  spinner on an empty page, so the layout does not jump when the data lands.
  Rebuilding the graph gets a real moving bar, because reading a whole project
  takes long enough that a still screen looks broken.

## [0.36.0] - 2026-08-28

### Fixed
- **A busy agent shows as busy again.** Claude and Codex report what they are
  doing through a hook script, and PulsarIDE was saving that script in one place
  while telling the agent to run it from another — so it never ran, nothing was
  ever reported, and an agent working away sat in the sidebar as a dead grey dot.
  The build now refuses to ship if those two ever disagree again.

## [0.35.0] - 2026-08-28

### Added
- **A red-on-black IDE.** The whole interface now wears the palette the Pulse
  mark is drawn in — near-black, red, violet — with the icon to match. Every
  text colour is contrast-checked in both light and dark, so it is readable as
  well as dark.
- **Buttons and progress that respond.** Presses feel like presses, loading bars
  travel instead of sitting there, and anything live has a quiet pulse. All of it
  switches off if your system asks for reduced motion.
- **The Pulse Agent's own tools reach every agent.** Your agents were told to
  call a router, an anti-loop check and a binary-triage tool that were never
  actually installed. They are now, and they work in Codex and Cursor too, not
  just Claude Code.

### Fixed
- **Routing picks the right team.** "Write unit tests" reached a design-systems
  team instead of Testing & QA, because a large team could win on sheer volume of
  words. It now uses the same scoring as the standalone agent.

## [0.34.0] - 2026-08-28

### Fixed
- **PulsarIDE kept answering as "ThePunisher".** If you also ran ThePunisher-Agent's
  own installer, PulsarIDE stepped aside and never deployed the agent it ships,
  so none of the renaming or updates reached you. Worse, the two rosters
  together are over Claude Code's budget for agent descriptions, which is what
  makes subagents quietly stop working. PulsarIDE's own roster now wins and the
  superseded copy is removed. An agent you wrote yourself is left alone.
- **Refresh in Brain Graph did nothing.** It only ever re-read the same file off
  disk, so it showed identical numbers every time. There is now a **Rebuild
  graph** button that actually re-indexes the project, and when it fails you get
  graphify's own words instead of silence.
- **A `.cursor` folder appeared in every project**, whether or not you use
  Cursor. Only written now if Cursor is actually installed.

### Added
- **The specialists are in the app.** Each team's named specialists — 5,372 of
  them — now ship with PulsarIDE, so when routing picks one the agent can
  actually become it. They were referenced but never included.
- **Graphify's own report in Brain Graph**: the most connected pieces of your
  code, connections you probably didn't know about, import cycles, what the
  graph can't answer yet, and questions it is uniquely placed to answer.

### Changed
- **Up to date with Orca again** (60 upstream commits).

## [0.33.0] - 2026-08-27

### Fixed
- **The updater could still have installed Orca over PulsarIDE.** Two feed URLs
  inside the updater were never repointed -- one of them the very first one set
  at startup -- so a check could resolve an Orca release and install it. Found by
  running the real build and reading what it logged. Everything the updater
  reads is ours now, and the build refuses to ship if that ever stops being true.
- **The window was still called "Orca"** in the title bar, the taskbar and the
  pop-out dashboard. It says PulsarIDE.
- **Open Design claimed to be installed when it wasn't.** `od` is also a standard
  Unix tool that exists on every Linux and Mac, so the panel found that instead
  and then showed a confusing error where your designs should be.

### Changed
- **Up to date with Orca again.**
- **New screenshots**, taken from an ordinary web project instead of a niche one,
  wide enough that the whole board fits, and now including the roadmap and the
  IDE's own sidebar.

## [0.32.0] - 2026-08-26

### Added
- **Brain Graph and Open Design are in the left sidebar**, under Tracker, as full
  pages rather than only narrow side panels. The graph overview finally has room
  to be read: the hubs, the relation mix, the node kinds and the confidence split
  sit side by side instead of stacked in a column, with this project's Obsidian
  note beside them. They stay available as sidebar tabs too.

### Fixed
- **No more graphify window sitting on top of your work.** Indexing runs a
  console program, and Windows was giving it its own window for the whole run.
  It runs out of sight now. The same went for git: every status and push could
  flash a window. Nothing PulsarIDE starts in the background will open a window
  again -- the build refuses to ship if one would.

## [0.31.0] - 2026-08-26

### Added
- **Docs come out clean.** Models quietly sprinkle invisible characters into the
  text they write — zero-width joiners, direction controls, Unicode tag
  characters, spaces that only look like spaces. They survive copy-paste and go
  on to break diffs, filenames and shell commands. Every agent in PulsarIDE now
  strips them from each document it writes, and the AI briefing the tracker
  generates is cleaned before it leaves. Real content — punctuation, emoji,
  Chinese, Arabic — is left exactly as written.

### Fixed
- **A channel switch can no longer install Orca over PulsarIDE.** The hourly,
  daily and adhoc update channels still pointed at Stably's repositories, so
  moving off stable would have downloaded Orca and installed it on top of your
  PulsarIDE. All four channels update from PulsarIDE now, and the build fails if
  a future Orca release ever adds one we missed.

## [0.30.0] - 2026-08-26

### Changed
- **Works is confirmed now.** When an agent reports something working, the board
  goes green straight away instead of waiting for you to tick every row. It says
  who confirmed it — "CONFIRMED · Codex" — and the button on that card becomes
  **decline**, so you can push back on anything that is not really working.
- **Up to date with Orca again**, 50 commits on. Everything PulsarIDE adds still
  applies cleanly and Orca's own full typecheck passes.

### Fixed
- **Clusters no longer read 0 on a real graph.** Older graphs have no cluster
  labels, and showing "0" for a 2,000-node project reads as broken. Brain Graph
  now works the grouping out from the connections themselves when the labels are
  missing.
- **Refresh stopped changing things.** It briefly re-ran project detection, which
  could rewrite your project type and language chips — on a button whose whole
  job is to show you what is there. It only reads again.
- **Two more places PulsarIDE and Orca shared a folder**: Grok's hook ownership
  and the background daemon's state. Both are ours now.

## [0.29.1] - 2026-08-26

### Fixed
- **The board could be corrupted when an agent wrote it while you had it open.**
  The IDE and the agent both wrote through the same temporary file, so one could
  rename it away while the other was still writing — and the rest of that write
  landed inside your live board. Each now uses its own, so they never collide.
- **The tracker woke up twice on every save**, because it was also watching the
  temporary files written next to the board.

## [0.29.0] - 2026-08-26

### Added
- **Open Design in the sidebar, for every agent.** OpenDesign turns a coding
  agent into a design engine — prototypes, dashboards, decks and documents,
  exported as real HTML, PDF, PPTX or MP4 — and it reaches agents over MCP, so
  one button wires Claude, Codex and Cursor at once. The tab shows whether it is
  installed, lists your design projects, and connects it on request. PulsarIDE
  never installs it and never writes its config: it runs OpenDesign's own
  command and shows you its own output, failures included.

### Fixed
- **Ghidra never actually ran.** The installer wrote its environment file to the
  wrong folder and then relied on Headroom's shell hook to load it — a hook
  PulsarIDE does not install. So `GHIDRA_HOME` was never set, and reverse
  engineering silently fell back to the basic tools instead of using the best
  analyser we ship. It now loads Ghidra itself, with no shell setup at all.
- **Headroom is gone.** Every reference to it has been removed from the bundled
  agents and the RE toolkit, so nothing tells an agent it is running.

### Changed
- **Our own checks stop letting new files slip past.** The syntax check ran off
  a hand-written file list, so anything added later was never checked. It now
  finds every source file instead.

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
