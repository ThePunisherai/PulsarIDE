# PlanIDE MCP server — let agents track their own work

`planide_mcp.py` exposes the tracker as [MCP](https://modelcontextprotocol.io)
tools so an AI agent (Claude, Codex, Cursor, …) can read the board and write
items/fixes/versions **itself, mid-session** — the "tracking via AI agents"
layer. It writes the same per-project state files the web UI reads, so a running
PlanIDE dashboard reflects the agent's updates live.

This is the **only** optional component with a dependency — the core PlanIDE
tool is pure Python stdlib.

```bash
pip install mcp
```

## Register it with your agent

**Claude Code / Codex / anything using an `mcpServers` block** (e.g. `.mcp.json`
in your project, or `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "planide": {
      "command": "python3",
      "args": ["/absolute/path/to/PlanIDE/mcp/planide_mcp.py"]
    }
  }
}
```

**Claude Code, one-liner:**

```bash
claude mcp add planide -- python3 /absolute/path/to/PlanIDE/mcp/planide_mcp.py
```

## Tools

| Tool | What the agent does with it |
|------|-----------------------------|
| `list_projects` | see all tracked projects + progress |
| `add_project(path, name)` | start tracking a folder (auto-detects stack) |
| `get_board(project)` | read items, fixes, roadmap, progress |
| `add_item(project, title, status, notes)` | log a new thing to build/fix |
| `set_item(project, item_id, status, …)` | **mark something works or broken** |
| `add_fix(project, title, problem, solution, agent)` | log a fix (with attribution) |
| `mark_fixed(project, fix_id, solution)` | **close a fix and record how** |
| `add_milestone` / `add_version` | update the roadmap / cut a version |
| `ai_report(project, mode)` | get the full briefing markdown |
| `detect_stack(path)` | detect a folder's language/type |

`project` is a registered id (`p_…`) or an absolute path (registered on the fly).

## The loop

> Agent fixes the broken save button → calls `mark_fixed(project, fix_id,
> "awaited the db call")` → the PlanIDE board flips it to ✓ and records the
> solution, attributed to the agent. No manual bookkeeping.

Prefer no dependency at all? Every one of these has a `./plan …` CLI equivalent
(`plan fix done`, `plan item set`, …) that any shell-capable agent can run
directly — see the top-level README.
