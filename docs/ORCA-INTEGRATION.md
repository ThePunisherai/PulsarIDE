# PlanIDE × Orca — phased integration plan

The goal: PlanIDE (todos / what-works-what-doesn't / full project management)
living **inside** an Orca-style multi-agent IDE, with the AI agents keeping the
tracker up to date as they work.

This is being delivered in phases so each step is real and verifiable, rather
than one big unverifiable desktop build.

## Phase 1 — the tracker brain ✅ (done, v0.1.0)

Standalone PlanIDE: board, fixes, roadmap, versions, GitHub sync (+LFS),
backups, stack auto-detect, AI export. One Python file, no build step, fully
self-tested.

## Phase 2 — AI-agent coupling ✅ (done, v0.2.0)

The agents track their own work, two ways (pick per agent):

- **CLI** (zero dependency) — any shell-capable agent (Claude Code, Codex) runs
  `./plan item set … --status works`, `./plan fix done …`, etc.
- **MCP server** (`pip install mcp`) — MCP-native agents (Cursor, …) call
  `set_item` / `mark_fixed` / `add_fix` tools directly. See `mcp/README.md`.

Either way the same per-project `.planide/state.json` updates, and a running
PlanIDE dashboard reflects it live. **Companion mode:** because Orca ships a
built-in Chromium browser, run `./start.sh` and open `http://127.0.0.1:8390`
as a panel beside your agents today — no fork required to get value.

## Phase 3 — native Orca panel (next)

Fork [`stablyai/orca`](https://github.com/stablyai/orca) (Electron + TypeScript)
and embed PlanIDE as a first-class panel, so it sits next to the agent terminals
and worktrees instead of in a browser tab.

**Approach (keeps the verified core; adds a thin native shell):**

1. **Bundle the engine, don't rewrite it.** Ship `server.py` + the `planide`
   package with the app and spawn it on a loopback port at launch (Electron
   `child_process`). The panel is a `<webview>`/`BrowserView` onto that local
   server — the exact UI already built and screenshot-verified here. No
   re-implementation of the tracker in TypeScript.
2. **Auto-register the active worktree.** Orca already knows the repo/worktree
   for each agent tab; on tab focus, `POST /api/project/add` that path so the
   panel always shows the project the agent is working in.
3. **Wire agent completion → tracker.** Orca's agents already emit
   start/finish/diff events. On an agent finishing a task, call the same
   `set_item` / `add_fix` endpoints the MCP tools use, pre-filled with the
   agent name — the diff-annotation feedback loop, but persisted as tracked
   fixes.
4. **Roadmap/versions as an IDE surface.** Surface `progress` + roadmap in
   Orca's status bar (how far along, how many broken) so it's glanceable.

**Why it's staged separately:** an Electron desktop build can't be run or
screenshot-verified in the current sandbox, so Phase 3 lands as a real fork PR
that gets tested on a desktop — not claimed working from here. Phases 1–2 give
the full capability *now* (companion panel + agent coupling); Phase 3 is the
native-embedding polish on top.

## Non-goals

- Not rebuilding Orca's terminals/worktrees/agent orchestration — that's Orca's
  job; PlanIDE is the tracking/PM layer beside it.
- Not rewriting the tracker in TypeScript — the Python engine is the source of
  truth and stays verifiable on its own.
