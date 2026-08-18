<div align="center">

<img src="tracker/static/icon.svg" width="96" alt="PlanIDE" />

# PlanIDE

**An agentic IDE that tracks its own work.**

Claude Code, Codex, Antigravity, Gemini, Cursor, Copilot and friends running in
parallel — with a project tracker built into the sidebar that knows what works,
what's broken, and what the agents just fixed.

</div>

---

## What it is

PlanIDE is [Orca](https://github.com/stablyai/orca) (MIT — a next-gen IDE for
parallel agentic development, with 40+ CLI agents, git worktree isolation, a
built-in browser and terminals) **rebranded as PlanIDE and extended with a
native project tracker**.

The missing half of agent-driven development isn't running the agents — Orca
already nails that. It's keeping track of **what actually works**, what broke,
what got fixed and by which agent, and how far along the project is. That's what
PlanIDE adds, in the sidebar, wired to the agents.

| | |
|---|---|
| **The IDE** | Orca upstream: parallel agents in isolated worktrees, terminals, browser, diffs, GitHub/Linear |
| **The tracker** | Board (works/broken/blocked/wip/todo), fix log with agent attribution, roadmap, versions, GitHub sync + LFS, backups, stack auto-detect, AI briefing export |
| **The wiring** | Agents update the tracker themselves — via CLI or MCP — while they work |

## Build it

```bash
git clone https://github.com/ThePunisherai/PlanIDE.git
cd PlanIDE
./ide/build.sh --run
```

That clones Orca at a pinned revision, applies the PlanIDE overlay (branding +
tracker panel + engine wiring), installs, and starts the IDE. Needs `git`,
`python3` and [`pnpm`](https://pnpm.io).

The tracker lives in the right sidebar behind the **radar icon**.

## Repo layout

```
PlanIDE/
├── tracker/          the tracker engine — Python stdlib only, no build step
│   ├── planide/      detect · store · gitsync · backup · aireport  (+ CLI)
│   ├── server.py     loopback HTTP API the IDE panel talks to
│   ├── static/       standalone web UI (works without the IDE)
│   └── mcp/          MCP server so agents update the tracker themselves
├── ide/              the Orca fork layer
│   ├── overlay/      our source: the sidebar panel, IPC bridge, engine service
│   ├── apply.py      anchored, verified, idempotent integration + branding
│   ├── build.sh      clone Orca → apply → install → run
│   └── verify.sh     does the overlay still apply to upstream?
├── docs/
└── verify.sh         runs both self-tests
```

### Why an overlay instead of a 210 MB vendored fork

Upstream Orca moves fast. Keeping only *our* code in `ide/overlay/**` and
re-applying it onto a pinned upstream revision means an upstream bump is one
line (`PINNED_COMMIT` in `ide/apply.py`) instead of a merge conflict across
16 000 files. Every edit is anchored to an exact upstream string and verified —
if upstream drifts, `apply.py` fails loudly naming the file, instead of
silently producing a half-patched IDE.

## Tracking *via* the agents

The point isn't exporting status to an agent — the agent should keep the tracker
current **as it works**. Two ways, pick per agent:

- **CLI** (zero dependency) — any shell-capable agent (Claude Code, Codex) runs:
  ```bash
  ./tracker/plan item set <proj> <item_id> --status works
  ./tracker/plan fix done <proj> <fix_id> --solution "awaited the query"
  ```
- **MCP** — MCP-native agents call `set_item` / `mark_fixed` / `add_fix`
  directly. `pip install mcp`, then see [`tracker/mcp/README.md`](tracker/mcp/README.md).

Both write the same state the sidebar panel reads, so a fix an agent logs
mid-session shows up in the IDE.

## The tracker on its own

The engine is a real standalone tool — useful without the IDE, and the reason
the IDE never re-implements any of it:

```bash
cd tracker
./start.sh                    # → http://127.0.0.1:8390
./plan add ~/code/my-emulator # register + auto-detect the stack
./plan report ~/code/my-app   # AI briefing → pipe it to any agent
```

It auto-detects the project type (web · desktop-exe · **emulator** · game ·
mobile · library · cli · custom) and language, tracks items and fixes, keeps a
roadmap and versions, snapshots zip backups, and syncs to GitHub including
large files via Git LFS.

State lives in `<project>/.planide/state.json` — inside the project, so it
travels with the code — plus a registry at `~/.config/planide/projects.json`.

## Verify

```bash
./verify.sh        # tracker: 25 checks · IDE overlay: 6 checks
```

## Credits & license

PlanIDE is built on [stablyai/orca](https://github.com/stablyai/orca)
(MIT, © Lovecast Inc.) — all agent orchestration, terminals, worktrees and
editor surface are upstream's work. The tracker, the sidebar panel, the engine
wiring and the overlay tooling are PlanIDE's.

PlanIDE's own code is [Apache-2.0](LICENSE).
