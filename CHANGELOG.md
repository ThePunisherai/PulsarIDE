# Changelog

What each version actually gives you. Newest first.

PlanIDE is [Orca](https://github.com/stablyai/orca) with a project tracker built
into it — the same parallel-agent IDE, plus a board that knows what works, what
is broken, what must not be touched, and what the agents have been doing.

## [0.81.0] - 2026-09-12

### What's fixed
- **Antigravity CLI now gets the Pulse roster properly.** It had the tracker
  tools and a Skill, but no Council and no team leads in `/agents` — nothing the
  agent could route to, unlike Claude Code and Codex. All 100 team leads plus the
  Council now deploy as real Antigravity custom agents, so they show up and can
  be invoked the same way.
- **Council now leads the session there too.** Antigravity has two global rules
  files and we only wrote one of them; the block goes into both `~/.gemini/GEMINI.md`
  and `~/.gemini/AGENTS.md` now, so it does not matter which one a given build reads.
- **Agent descriptions are no longer cut mid-sentence.** A folded description
  was truncated at its first line, losing the half that says what the agent is
  for — which is exactly what Antigravity routes on.

## [0.80.0] - 2026-09-11

### What's new
- **Upstream Orca is up to date** (`7dd183d` → `7294915`). Everything the IDE
  adds still sits on top of it: all 64 anchored edits apply, nothing upstream
  was removed, and re-applying changes nothing.

### What's fixed
- **Re-homed the two edits upstream moved.** Orca gutted
  `client-ui-schemas.ts` (244 lines → 8) and moved its schemas into
  `src/shared/rpc-contract/client-ui-params.ts`, where they are exported rather
  than file-local. Those are the two that register the tracker and the Brain
  Graph / Archify / Toolkit pages as real views — without them the app would
  refuse to restore the tab you left open.

## [0.79.0] - 2026-09-11

### What's new
- **The Fixes tab has actions.** Close a fix with the solution that actually
  worked, reopen one that came back, park it as won't fix, or delete it. Filter
  by Open / Fixed / Parked so the ones still asking for something are not buried
  under everything already closed.
- **Council works the board.** Its own persona now tells it to read `get_board`
  before routing, keep the plan synced while it works, and walk the open fixes —
  closing them with real evidence, reopening regressions, parking what is
  deliberately not being fixed, and saying which it left open and why.
- **Archify fills itself in.** A project with no diagram gets a factual one on
  first open: the real top-level directories, typed and laid out. It draws no
  connections on purpose — the IDE can say what exists, not how it relates. An
  agent replaces it with the real thing; the seed is never written twice and
  never over an authored diagram.
- **`reopen_fix`** is a real tracker tool for every agent, not just a button.

### What's fixed
- **Brain Graph put the useless half first.** Because the graph is built with no
  API key, communities never get names — so four sections said nothing ("Community
  0" … "Community 9", the same numbers with raw cohesion floats, "file stats not
  available"). Measured on a real report: 49 of 76 lines. They sat above god
  nodes, surprising connections, import cycles and knowledge gaps. Those lead
  now; the rest is one click away, with a line saying why it is quiet.
- **A reopened fix kept its old close date** and, worse, logged nothing when it
  was closed the second time.

## [0.78.0] - 2026-09-11

### What's new
- **caveman, installed.** A writing mode that cuts roughly two thirds of output
  prose while keeping code, commands, errors, numbers and negations exact. Ask
  for it with `/caveman` or "be brief". MIT, vendored, no key, no proxy.
- **rtk, detected.** If `rtk` is on your PATH, agents run noisy commands through
  it so less of a build log reaches the context. Toolkit shows whether it is
  there and how to install it — the IDE will not install it for you, because its
  setup writes a global shell hook.
- **A "Fewer tokens" card in Toolkit**, saying which of the two is live.

### What's deliberately not included
- **Caveman's compressing proxy.** It is BSL-1.1 rather than MIT, and it stands
  between the agent and its provider. You sign in with an account, not an API
  key, and a proxy in that path is exactly what broke Codex logins here before.
  The saving is not worth the sign-in.

## [0.77.0] - 2026-09-11

### What's fixed
- **"Broken 1" with nothing in the Broken column.** The tile summed broken *and*
  blocked while calling itself Broken, so a blocked item showed up as broken and
  then wasn't there. The tile now counts the column it names.
- **"Wire the missing ones" looked dead.** A config it cannot parse is one it
  refuses to rewrite — rewriting your `mcp.json` would throw away your comments.
  That refusal was right; doing it in silence was the bug. The row now says the
  file isn't valid JSON and that it was left untouched.
- **Snapshots were slow and memory-hungry.** The whole archive was built in RAM —
  briefly twice over — before a byte reached disk. It streams now: peak memory is
  one file, not the backup. (`node_modules`, `.git`, `venv`, `build` were already
  excluded and still are.)
- **The board scrolled sideways.** Columns share the width and fit now.
- **Squeezed Roadmap text.** A long milestone target refused to shrink and
  crushed the title to one word per line. It wraps, and takes at most half.

## [0.76.0] - 2026-09-11

### What's fixed
- **The Council never knew ECC existed.** ECC shipped, deployed, and was named in
  the always-loaded instruction block — but not in the Council's own persona file.
  A subagent runs on its persona, not on that block, so the one deciding what to
  reach for had never heard of the 359 entries. It is in the persona now, for
  Claude Code, Codex and Gemini CLI alike, with when to call `ecc_find` and when
  to say it does not fit.
- **The entry count was wrong.** The block claimed 354; counted on disk it is 359
  (291 skills + 68 agents).

### What's new
- **Unreal Engine MCP installs itself.** Choose a folder and the IDE downloads the
  server into it. It used to ask you to clone the repo first and then point at it —
  the wrong half of the job to hand back.

## [0.75.0] - 2026-09-10

### What's new
- **ECC is in the box.** The 291 skills and 68 agents now ship inside PulsarIDE
  and are deployed on launch — no git, no network, no npx, nothing to fail. If
  you installed ECC yourself, your copy is left untouched.
- **Unreal Engine MCP.** Point Toolkit at your `unreal-engine-mcp` clone and it
  registers for all seven agents. It checks the folder really holds the server
  before registering, so no agent shows a tool that cannot start. You still need
  `uv` on PATH and the UnrealMCP plugin enabled in your project.
- **Archify renders by itself.** A diagram an agent wrote no longer waits for you
  to click Render.

## [0.74.0] - 2026-09-10

### What's fixed
- **Archify's "Open" did nothing.** It was a `file://` link, which the Electron
  renderer refuses to navigate. It now opens the diagram in a real window, the
  same way the Brain Graph already did.
- **Meshy asked for its key in two places.** The key field sat in the Archify tab
  as well as on Toolkit; Archify no longer shows it — Toolkit owns it.
- **Toolkit's ECC switch looked broken.** Turning ECC on only wrote a preference
  and waited for the next launch. It now fetches immediately.

### What's new
- **Pick the folder Toolkit checks.** A native folder picker, so you can point
  the checks at the project you mean instead of only the active worktree.

## [0.73.0] - 2026-09-10

### What's fixed
- **The big progress ring read 0% while most of the board was done.** v0.71.0
  correctly stopped counting an agent's claim as your confirmation — but the
  headline number was wired to *your confirmations*, so a solo user whose agents
  do the work saw a permanent 0% even with 65 of 104 cards finished. The ring and
  the sidebar bar now headline **completion** (how far the board has moved); the
  green arc still shows the slice you've personally checked, and the amber shows
  what agents claimed but you haven't. "How far are we" finally has an honest
  answer on screen.
- **An agent asking the board "how far are we" got a different number than the
  IDE showed.** The MCP `get_board` rollup counted agent self-confirmations as
  confirmed; it now draws the same line the IDE does, so the two agree.

## [0.72.0] - 2026-09-10

### What's new
- **Toolkit, in the left nav.** One page showing everything this IDE wires into
  your agents, read back from your machine rather than claimed: whether the
  tracker server actually starts (it is launched, not just found) and the exact
  command used, which config file each of the seven agents keeps and whether our
  servers are named in it, which agents keep the board current by themselves, and
  a button to wire up any that are missing.
- **Meshy and ECC finally have somewhere to live.** Meshy's key was buried in the
  Archify tab and ECC had no interface at all, so neither looked like it existed.
  Both are on the Toolkit page now, with ECC's on/off switch and what it costs.

### What's fixed
- **Agents are told not to write `.planide/state.json` themselves.** One was
  caught scripting around the tools and editing the board by hand, which races
  the IDE and skips the rollups. If a tool looks broken it should be reported,
  not routed past.

## [0.71.0] - 2026-09-10

### What's fixed
- **The board said you had confirmed work you never looked at.** An agent
  reporting `works` or `done` sets the confirmed flag under its own name, but the
  totals counted that as yours — so a run where one agent closed out 63 items
  showed "63 confirmed by you, 0 claimed by an agent", the exact opposite of what
  happened. Only your own check counts as confirmed now; an agent's counts as
  claimed, which is what the CLAIMED tile was always meant to show.
- **Health was scored on self-reported work.** It runs off your confirmations
  now, which is what it always said it measured.
- **Green is yours again.** A card an agent confirmed shows an amber
  `claimed · <agent>` badge instead of a green CONFIRMED one.

## [0.70.0] - 2026-09-10

### What's new
- **Gemini CLI and Qwen Code now update the board by themselves too.** They have
  a plan tool (`write_todos`) on their own `AfterTool` event, so four of the
  agents — Claude Code, Codex, Gemini CLI, Qwen Code — no longer depend on
  remembering to call `sync_plan`. Antigravity, Cursor and opencode still do.
- **A cancelled step stays off the board.** Gemini can mark a step `cancelled`,
  and the board has no such column; showing work the agent abandoned as still
  outstanding would be worse than not showing it. `blocked` maps to the real
  blocked column.

## [0.69.0] - 2026-09-10

### What's fixed
- **Codex no longer has to remember to update the board.** Claude Code had a hook
  doing it automatically; Codex only reached the board if the model chose to call
  `sync_plan`. Codex has a real equivalent — `PostToolUse` matched on its own
  `update_plan` tool — and it is now wired to the same script, so a plan you make
  in Codex lands on the board by itself.

### What's new
- **One plan hook, both agents.** The same launcher reads Claude Code's
  `TodoWrite` payload and Codex's `update_plan` payload; the shapes were taken
  from each project's own source, not from a guide.

## [0.68.0] - 2026-09-10

### What's fixed
- **A plan could vanish and be reported as synced.** If a step's text was not in
  `content` — Codex's own plan tool calls it `step` — `sync_plan` returned
  "0 added, 0 moved" as a success and the board stayed empty. That is exactly
  what "the todo list doesn't work" looks like, with nothing anywhere saying so.
  `step` is now accepted, and steps that genuinely cannot be read are reported
  instead of swallowed.
- **A partly-readable plan keeps the steps that were fine.** The readable steps
  land and the response names what was dropped; only a plan with nothing
  readable in it fails outright.

## [0.67.0] - 2026-09-10

### What's fixed
- **Antigravity never had the tracker at all.** It shares `~/.gemini` with Gemini
  CLI but not its settings file — the IDE, the `agy` CLI and the SDK read
  `~/.gemini/config/mcp_config.json`, which we never wrote. Every `planide` and
  `pulsar-tools` tool was simply absent there. Now written, older
  `~/.gemini/antigravity-cli` layout included.
- **The health banner stayed green while one agent was broken.** Antigravity was
  folded into Gemini's row, so it could not report on itself. It has its own row
  now, and any tool that is installed but unwired is named in the banner instead
  of hidden behind the ones that work.

### What's new
- **A plan is proven to reach the board from all seven agents.** The test suite
  now takes the launch command out of each agent's own config file, runs it, and
  syncs a real plan — Claude Code, Codex, Gemini CLI, Antigravity, Qwen Code,
  Cursor and opencode. Anything that only worked in Claude Code fails the build.

## [0.66.0] - 2026-09-10

### What's fixed
- **Codex only ever got the tracker, never the toolkit.** It was registered for
  `planide` alone — so in Codex there was no `route_task`, no `ui_find`, no
  `ecc_find`, no anti-loop check. It now gets every server, same as the others.
- **Your plan reaches the board from any agent.** The TodoWrite hook works, but
  it is Claude Code's hook — in Codex nothing was syncing. New `sync_plan` tool:
  send your whole plan, steps are matched on their text, so a revised plan moves
  what moved and adds what is new instead of duplicating.

### What's new
- **Meshy 3D, one field.** Paste an API key in the Archify tab and Meshy's 24
  tools are registered for Claude Code, Codex, Cursor, Gemini and Qwen at once.
  Clear it and they are removed again. The key is never read back into the field.
- **`docs/INTEGRATIONS.md`** — every repository evaluated, what was done with it,
  and why the ones left out were left out.

## [0.65.0] - 2026-09-09

### What's fixed
- **Archify was only ever using a fraction of itself.** Guided views you can play
  through, the summary cards under the diagram, node sublabels, and full
  Before/Delta/After comparison were all installed and all working — the Council
  was only ever told about bare `render`, so you got box-and-arrow sketches. It
  now delivers at `--quality showcase` (a real gate: 9 artifact checks, refuses
  warnings) and knows the four fields that carry the rest.
- **Deltas show up in the Archify tab.** `compare` takes two snapshots and writes
  one artifact, so it had no JSON to pair with and the tab silently skipped it —
  the most useful thing the toolkit makes was the one thing you couldn't see.

### What's new
- **Diagrams get offered per project.** A project with real architecture and no
  diagram is treated as a gap to raise, not something to wait to be asked about.
- `compare`, `guide`, `brands` and `visual-check` are now part of what the Council
  reaches for.

## [0.64.0] - 2026-09-09

### What's fixed
- **ThreeUI actually gets used now.** 44 installed 3D/shader components kept being
  skipped while WebGL got written by hand next to them. The reason was the names:
  nothing about `bell-field` says "animated background", so the index the agent was
  told to read couldn't answer the question it existed for.

### What's new
- **`ui_find` / `ui_read`.** Ask for the visual you want — "an animated hero
  background", "a 3D dock" — and get matching components with what they actually
  are, then read one to copy and adapt. Two tools on the `pulsar-tools` MCP server,
  so it works in Codex, Cursor, Gemini and Qwen too.
- **The index has real descriptions.** Taken from ThreeUI's own catalogue
  (MengTo/threeui, MIT) rather than written here, so they describe the components
  instead of guessing at them.

## [0.63.0] - 2026-09-09

### What's fixed
- **"Transport closed" on every planide tool call.** The tracker MCP server was
  registered to run under the app's own ~200 MB Electron binary. On Windows that
  can take longer to start than the agent is willing to wait, so the process was
  killed before it answered — tools resolved, calls failed, board never moved. It
  now runs on a real `node` when there is one, and only falls back to the app
  binary when there isn't. Existing installs fix themselves the first time you
  launch this version.
- **The Tracker panel now says why, not just that.** The health check captures the
  runtime's own stderr and exit code, so a dead server reports its actual reason
  instead of a shrug.

## [0.62.0] - 2026-09-09

### What's fixed
- **ECC no longer costs you 40,600 tokens a session.** v0.60.0 installed it as a
  plugin, which loads all 354 skills and agents into every session on every
  project. Now only its catalogue lands on disk — `marketplace add` clones
  everything and installs nothing — so it costs **zero** until it's used.

### What's new
- **The Council calls ECC when it needs it.** Two new tools on the `pulsar-tools`
  MCP server: `ecc_find("<your task>")` searches the catalogue, `ecc_read("<name>")`
  returns the file to follow inline. Works in Codex, Cursor, Gemini and Qwen too,
  not just Claude Code.
- **Matches say how good they are.** Each result is `strong` or `weak`, and weak
  means it shares a word with your task, not a subject — ECC doesn't cover
  everything, and saying so beats a confident wrong answer.

### Notes
- Want ECC fully loaded anyway? `claude plugin install ecc@ecc` — the marketplace
  is already registered, so it's one command.

## [0.61.0] - 2026-09-09

### What's new
- **Orca is current again.** Pinned forward 715 commits to `7dd183d`, after five
  releases held back. You get everything upstream shipped in that window —
  terminal and runtime performance work, the reworked sidebar create actions,
  native-chat fixes.

### What's fixed
- Three overlay anchors upstream had moved under us: both Windows-signing
  anchors in the builder config, and the PowerShell agent-hook line — that last
  one now anchors on just the path, so upstream reshuffling that command can't
  break it a third time.

### Please read
- The v0.55.0 React #185 boot crash was never reproduced, only pinned around. A
  typecheck can't see a render loop, so **if the app crashes a few seconds into
  boot, tell me** — it pins straight back to `61e0100` as a patch release.

## [0.60.0] - 2026-09-09

### What's new
- **ECC comes pre-installed.** First launch runs ECC's own official setup, so its
  68 agents and 380 skills are just there — nothing to type. Not mirrored into
  our installer: their installer, their updates.
- **And it's a switch.** Measured with Claude Code's own `plugin details`, ECC
  adds **~40,600 always-on tokens** to every session on top of Pulse Agent's
  ~16,800. Set `"installEcc": false` in `~/.config/pulsaride/settings.json` if
  you'd rather keep that context.

### Notes
- Needs Node 18+ and one network call. Missing either, it quietly doesn't happen
  — the reason lands in `ecc-install.json` and it isn't retried every launch.

## [0.59.0] - 2026-09-09

### What's new
- **The Tracker panel says why agents stopped updating the board.** It checks the
  whole chain on every project — server on disk, runnable with the exact command
  the agents were handed, named in each tool's config, board writable — stays
  silent when it's fine, and names the broken link when it isn't.
- **Repair agent wiring.** One button writes the `planide` entry back into every
  agent's config. Claude Code owns `~/.claude.json` and rewrites it on its own
  schedule, so ours can go missing through nobody's fault — now that's a click,
  not a reinstall.
- **ECC support, without the cost.** Install [ECC](https://github.com/affaan-m/ECC)
  its own official way and the Council is told what it's for and that Pulse Agent
  still leads. Not installed? Never mentioned, no context spent.

### Unchanged on purpose
- Still pinned to Orca `61e0100`. There are 715 upstream commits waiting, but
  bumping while something is reported broken makes it impossible to tell whose
  bug it is.

## [0.58.0] - 2026-09-08

### What's new
- **Qwen Code is a first-class agent now.** It gets the same 100 team leads
  (`~/.qwen/agents`), all 77 skills (`~/.qwen/skills`), the Council instruction
  in `~/.qwen/QWEN.md` and the live tracker tools in `~/.qwen/settings.json` —
  the same deal Claude Code, Codex and Gemini CLI already had.
- **Every other agent, through `AGENTS.md`.** Opening a tracked project now
  merges the Pulse Agent block into the repo's `AGENTS.md` — the open format
  Amp, Jules, Zed, Factory, Aider, Copilot and 30-odd others read. Your own
  content in that file is kept; only our block is replaced on an update.

### What's fixed
- **A release that only changes the instruction now actually redeploys.** The
  freshness check looked at the bundle's files, so a version that adds a new
  tool without changing a bundled file decided nothing had changed and skipped —
  which would have left `~/.qwen` empty after updating. It now also covers where
  the build deploys to, so adding a tool is enough to trigger it.

## [0.57.0] - 2026-09-08

### Removed
- **Open Design is gone.** The tab, the left-nav entry, the sidebar panel, the
  install/connect/launch plumbing and the `od` detection all came out — it was a
  web/SaaS design engine that never fit what this IDE is used for.

### Fixed
- **The bundled libraries were never actually reached for.** ThreeUI, the
  agency-agents roles, Archify and the skills were all installed and all
  described to the Council — but a hundred lines deep in a wall of prose, after
  the Council steps, the loop guard and the tracker rules. So design work got
  hand-rolled while 44 ready-made 3D components sat on disk. The instruction now
  opens with a short routing table: match the work to a row, open what it names,
  and say so in one line if you did not.

## [0.56.0] - 2026-09-08

### Added
- **25 more skills, built in.** [mblode/agent-skills](https://github.com/mblode/agent-skills)
  (MIT) ships pre-installed: shipping (`planning`, `pr-reviewer`, `pr-creator`,
  `pr-babysitter`, `tidy`, `autoship`), design (`product-design`, `ui-design`,
  `ui-verification`, `ui-animation`, `presentation-creator`), audits (`ax-audit`,
  `dx-audit`, `typography-audit`, `seo`), architecture (`codebase-architecture`,
  `scaffold-nextjs`, `scaffold-cli`, `multi-tenant-architecture`), writing and
  skill authoring. 52 skills to 77, none of them shadowing a skill already here.
  The Council is told what each group is for and to open them by name.

### Fixed
- **"The agent never even gets called."** Each of the 100 team-lead subagents was
  told to announce itself with a `🔴 Pulse Agent — <team>` banner, but a main
  session is not a subagent, and the always-loaded instruction never asked for
  one — it only referred to a banner it never requested. So in the usual case,
  where the Council runs in your main session rather than a dispatched subagent,
  nothing ever said it was there, which is indistinguishable from it never
  running. Every tool's memory file now carries the rule.

## [0.55.1] - 2026-09-05

### Fixed
- **The app no longer trips a render loop a few seconds after opening.** A real
  Windows install on 0.55.0 hit React's "maximum update depth" error at boot.
  0.55.0's only renderer change was the jump to a newer Orca (201 upstream
  commits, several of them reworking exactly that area) -- our own part of that
  release never touched a single renderer file. PulsarIDE is pinned back to the
  Orca it ran on in 0.54.0, which had no such report.
- The OpenDesign detection fix from 0.55.0 is **kept** -- it lives in the main
  process and had nothing to do with the crash.

### Known
- This holds PulsarIDE on the older Orca for now, so Orca's newest work is not
  in this build. Moving forward again needs a real boot test on Windows: both
  our checks and Orca's own typecheck passed on the newer revision and neither
  could catch this, because a render loop only shows up at runtime.

## [0.55.0] - 2026-09-04

### Changed
- **On the newest Orca again.** PulsarIDE now tracks upstream at `b0df874`, the
  build that adds Orca's computer-use and orchestration work. All 64 overlay
  edits still apply -- only one anchor needed re-homing (upstream reflowed one
  build-config array), so the tracker, the board, the brain and every agent
  integration ride on top of it unchanged.

### Fixed
- **"OpenDesign installed but not detected."** OpenDesign's desktop app puts its
  `od` command on your PATH, but so does GNU coreutils (`/usr/bin/od`, the
  octal-dump tool) -- and OpenDesign's own README warns coreutils can shadow it.
  We only checked the first `od` on PATH, found coreutils, and reported nothing
  installed. Now every `od` on PATH is checked and the real OpenDesign one is
  used even when coreutils sits in front of it.

## [0.54.0] - 2026-09-02

### Changed
- **Rebuilt on the newest Orca.** PulsarIDE now tracks upstream at `61e0100`,
  which brings Orca's new agent dashboard and a large internal reorganisation --
  the 3,000-line UI store and the entry point were each split into modules. The
  tracker, the board, the brain and every agent integration ride on top of it
  unchanged.

### Fixed
- **A blind spot in the update-safety check.** PulsarIDE has a guard that refuses
  to ship if anything feeding the auto-updater still points at Orca's releases --
  the check that exists because a build once shipped doing exactly that, which
  would install Orca over PulsarIDE. Upstream moved those URLs into a new folder
  that the guard's file pattern did not reach, so it had quietly stopped checking
  the files that matter. It now looks in the whole updater tree.

## [0.53.0] - 2026-09-02

### Added
- **The agent's plan is on the board.** Claude Code works from a step-by-step
  todo list, and it lived only in the chat. Those steps now appear on the board
  as it plans, move to in-progress as it starts each one, and land in `works`
  when it finishes — with the whole run kept in the project's local database. It
  never marks anything confirmed for you, and never touches a step you have
  protected.
- **It remembers what fixed things, not just what failed.** A new
  `record_solution` records the actual fix. After that, any later session asking
  about the same problem is told it is already solved and how — so settled work
  does not get quietly re-solved or undone — and the dead ends it went through
  stop blocking further work in that area.
- **Install OpenDesign from inside the IDE.** It is a separate desktop app with
  no installable package, so it cannot ride along inside PulsarIDE — but the
  panel now fetches the right build for your machine and starts its installer,
  which was the tedious part.

### Changed
- **graphify's own graph, inside the app.** The panel draws the busiest slice
  that fits beside the numbers; graphify writes a full explorable view of the
  same graph. That view now opens in a window in the IDE instead of being
  handed to your browser — the same picture graphify makes, not a second one.

## [0.52.0] - 2026-08-30

### Fixed
- **Auto-update works again on Windows.** Every downloaded update was refused
  with *"not signed by the application owner: publisherNames: SignPath
  Foundation"* — the app claimed the upstream project's signing identity while
  our own builds ship unsigned, so it rejected its own updates and no fix could
  ever reach you. It no longer claims a publisher it does not have.
  **One manual install is needed to escape it:** the check is made by the
  *installed* app, so your current copy will refuse this update too. Install
  v0.52.0 by hand once from the releases page; updates work by themselves after
  that.

### Added
- **The loop guard now catches churn, not just repeats.** It already refused to
  retry an approach that had failed. It never noticed an agent inventing a *new*
  approach every time for the same broken thing — which is the loop you actually
  see. Four different dead ends on one problem now stop the suggestions and send
  it back to you with what has been ruled out. The idea is taken from
  `Ranteck/graph-engineer`, which stops when passes stop making progress.
- **graph-engineer, pre-installed.** The skill itself ships too: one model
  orchestrates while another writes and adversarially reviews, as a
  self-correcting cycle. Its author calls it design-stage rather than
  battle-tested, so it is offered for work that warrants a second opinion — not
  as the default path.

## [0.51.0] - 2026-08-30

### Fixed
- **Archify diagrams render again.** Every diagram that was not an *architecture*
  diagram failed silently: the IDE passed archify a `--repo-root` flag that only
  architecture accepts, so data-flow, workflow, sequence and lifecycle renders
  were rejected before they started. All five types render now, and each one is
  tested against the real archify on every build so this cannot come back.
- **Updates reach nested files.** The check that decides whether your installed
  agent files are current only looked at the top level of each folder, so a
  change *inside* one — a skill, a tracker module, a role in a library — left
  everything looking up to date and was never written to your machine. It now
  looks at the whole tree.

### Added
- **274 role agents, pre-installed.** An MIT-licensed library of specialised
  roles across 19 divisions — engineering, design, marketing, security, product,
  testing, game development, GIS, finance and more — installed with the app and
  used when a task needs a specialisation the teams do not cover. Read inline
  rather than registered, so they cost nothing from the subagent budget that
  broke dispatch once before.
- **44 ThreeUI components for real design work.** MIT React + three.js shader and
  3D UI components ship with the app, indexed, so an agent asked for an animated
  background or a 3D hero adapts a real component instead of writing WebGL from
  scratch.
- **graphify's own view, one click away.** The Brain Graph draws the slice that
  fits beside the numbers; graphify also writes a full explorable view of the
  same graph, and there was no way to reach it. Now there is.

### Changed
- **The Open Design panel is honest and reachable.** Open Design is a separate
  desktop app that publishes no package we can install for you, so it cannot be
  bundled the way the ThreeUI components are. The panel now at least gets you
  there in one click instead of printing an address to retype, and points at the
  44 design components that are already installed.

## [0.50.0] - 2026-08-30

### Added
- **The board now shows what your agents are doing.** Codex, Claude, Antigravity
  and the rest write to the tracker inconsistently on their own, so a project
  they worked all day could still show an empty board — "I see no changes". The
  IDE now puts the work on the board itself: when an agent finishes a real turn,
  the thing you asked for lands as a `wip` card, attributed to that agent. It is
  deduped so one task is one card, never marked done for you, and driven by the
  IDE's own signal — so it shows up even for an agent that never calls a tool.
- **History: every change to a board, kept in full beside it.** A new tab on the
  Tracker, backed by a real per-project database (`.planide/history.db`). The
  board's own activity is capped; this is not — it is the complete record of what
  moved and when, agents and you, newest first, so you can see exactly what an
  agent did to a project over days, not just its last few lines.

### Fixed
- **Archify diagrams that actually render.** Its schema is strict, so agents that
  invented the shape produced files that silently failed to draw — "archify werkt
  niet helemaal". Agents are now told to copy a real example as their exact
  starting shape and to validate before rendering, so what they write lands as a
  diagram instead of a validation error.
- **The dev-build icon is a dev icon again.** The amber tint that tells a `dev`
  window apart from the shipped app pointed at colours the mark no longer uses, so
  the two looked identical. It wears the amber pulsar again.

### Changed
- **Buttons with a little depth.** The primary actions sit on a soft shadow and
  lift, faintly lit in the brand red, when you hover — the flat variants stay
  flat, and nothing else about how a button behaves changed.
- **Up to date with Orca.** Picks up the latest upstream Orca with no change to
  how anything works.

## [0.49.0] - 2026-08-29

### Added
- **Brain Graph finally shows a graph.** It reported counts, hubs and bars but
  never drew the thing it is named after. It now draws the most connected pieces
  of your project and the links between them — hover a node to light up what it
  touches, sized by how connected it is and coloured by what it is. It shows the
  busiest slice rather than all ~2,000 nodes, and says so, because the whole
  thing at once is a hairball nobody can read.

### Fixed
- **The graph keeps itself current.** It only ever moved when you pressed
  Rebuild, so in a project agents work in daily it sat reading "updated 4 days
  ago". When it is more than a day old it now rebuilds itself once in the
  background the first time you open that project — never for a project with no
  graph yet, and never twice in a session.

## [0.48.0] - 2026-08-29

### Changed
- **The rest of the IDE looks like the rest of the IDE.** The theme dressed
  PulsarIDE's own panels, but the editor, settings and dialogs still used browser
  defaults: text selected in blue, scrollbars in the platform's light grey on a
  near-black window, and keyboard focus you had to hunt for. Selection, carets,
  focus rings, scrollbars and plain links now follow the same palette everywhere,
  including on screens PulsarIDE did not build.

## [0.47.0] - 2026-08-29

### Fixed
- **New releases actually reach you.** PulsarIDE checked for updates once every
  24 hours, so a fix shipped this afternoon could sit unseen until tomorrow. It
  now checks every two hours, and when it finds one it downloads it in the
  background so it is ready the moment you agree to install. Installing is still
  your call — nothing is applied under you mid-session.

## [0.46.0] - 2026-08-29

### Changed
- **Up to date with Orca again.** Everything PulsarIDE adds still applies cleanly
  on top, checked before shipping rather than after.

## [0.45.0] - 2026-08-29

### Added
- **Archify, in the left sidebar.** Ask an agent to diagram this project and the
  result appears under Archify — architecture, workflow, sequence, data-flow and
  lifecycle diagrams as interactive HTML you can open. Diagrams live in
  `.planide/diagrams` beside the board, the panel shows when one is out of date
  with its source, and re-rendering is one click. It is bundled (MIT,
  tt-a1i/archify) and runs on the IDE's own Node, so there is nothing to install.
- **Spec-driven development.** GitHub's Spec Kit workflow (MIT) ships as a skill:
  specification first, then a technical plan, then a task breakdown, then the
  code. The agents put each stage on the board as they go, so you can see where a
  feature is without reading the documents. No install — the Python CLI is not
  needed for the workflow itself.

## [0.44.0] - 2026-08-29

### Added
- **opencode gets the tracker too.** It is one of the agents PulsarIDE runs, and
  it was the only one with no tracker tools. Its config is a different shape from
  the others, so this was written against opencode's own documentation rather
  than assumed. If you keep your own global rules file it gets the Pulse Agent
  block added to it; if you do not, nothing is created, because opencode already
  falls back to the Claude file that has it.

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
