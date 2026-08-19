#!/usr/bin/env python3
"""PlanIDE MCP server -- let an AI agent track its own work.

Exposes the tracker as MCP tools so an agent (Claude, Codex, Cursor, ...) can,
mid-session, read the board and write items/fixes/versions itself -- the
"tracking via AI agents" layer. It mutates the same per-project state files the
web UI reads, so a running PlanIDE dashboard reflects the agent's updates live.

This is the ONE optional component that needs a dependency (the core tool is
pure stdlib):   pip install mcp

Register it with your agent, e.g. Claude Code (~/.claude/mcp.json or .mcp.json):

    {
      "mcpServers": {
        "planide": { "command": "python3",
                     "args": ["/absolute/path/to/PlanIDE/mcp/planide_mcp.py"] }
      }
    }

Every tool takes `project` = a registered id (p_...) or an absolute path (which
is registered on the fly, exactly like the CLI).
"""

from __future__ import annotations

import os
import sys

# Resolve the real MCP SDK FIRST -- before adding the repo root to sys.path.
# The repo root contains a directory literally named 'mcp' (this one), which
# would otherwise shadow the installed 'mcp' package and break the import.
try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    sys.stderr.write(
        "PlanIDE MCP server needs the 'mcp' package.\n"
        "  pip install mcp\n"
        "(The core PlanIDE tool needs nothing -- this bridge is the only extra.)\n")
    raise SystemExit(1)

# Now it is safe to make the local `planide` package importable.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from planide import store, aireport, detect  # noqa: E402

mcp = FastMCP("planide")


def _resolve(project: str):
    if project.startswith("p_"):
        return store.state_for(project)
    path = os.path.abspath(os.path.expanduser(project))
    if path not in {p["path"] for p in store.load_registry()}:
        store.register(path)
    return store.load_state(path), path


@mcp.tool()
def list_projects() -> list:
    """List tracked projects with id, name, type, version and progress %."""
    out = []
    for p in store.load_registry():
        s = store.summarise_project(p)
        pr = s.get("progress") or {}
        out.append({"id": p["id"], "name": s.get("name"), "type": s.get("type"),
                    "version": s.get("version"), "percent": pr.get("percent", 0),
                    "broken": pr.get("broken", 0), "open_fixes": pr.get("open_fixes", 0),
                    "path": p["path"], "exists": s.get("exists")})
    return out


@mcp.tool()
def add_project(path: str, name: str = "") -> dict:
    """Register a project folder (auto-detects its language/stack)."""
    e = store.register(path, name)
    st = store.load_state(e["path"])
    return {"id": e["id"], "name": e["name"], "type": st.get("type")}


@mcp.tool()
def get_board(project: str) -> dict:
    """Get the full board: items, fixes, roadmap, progress, and what is off-limits.

    Read `protected` before changing anything: those items are marked DO NOT
    BREAK by the user. Do not refactor, rename or 'improve' them as a side
    effect of other work -- if a change requires touching one, stop and ask.
    `regressions` lists protected items that are already broken; those take
    priority over any new work.
    """
    st, _ = _resolve(project)
    return {
        "name": st["name"], "type": st.get("type"), "version": st.get("version"),
        "progress": store.progress(st),
        # `verified` = the user confirmed it; `locked` = the user protected it
        # (DO NOT BREAK); `claimed_by` = who reported it. Agents read all three
        # and can write none of them.
        "items": [{"id": i["id"], "title": i["title"], "status": i["status"],
                   "notes": i.get("notes", ""), "verified": i.get("verified", False),
                   "locked": i.get("locked", False),
                   "claimed_by": i.get("claimed_by", "")} for i in st["items"]],
        "protected": [i["title"] for i in st["items"] if i.get("locked")],
        "regressions": [i["title"] for i in store.regressions(st)],
        "fixes": [{"id": f["id"], "title": f["title"], "status": f["status"],
                   "problem": f.get("problem", "")} for f in st["fixes"]],
        "roadmap": [{"id": m["id"], "title": m["title"], "done": m.get("done")}
                    for m in st["roadmap"]],
    }


@mcp.tool()
def add_item(project: str, title: str, status: str = "todo", notes: str = "",
             agent: str = "") -> dict:
    """Add a tracker item. status: todo|wip|works|broken|blocked|done.

    Set `agent` to your own name so the board shows who reported it. Note that
    marking something `works` records a CLAIM -- only the user can confirm it.
    """
    st, path = _resolve(project)
    it = store.add_item(st, title, status, notes, claimed_by=agent)
    store.save_state(path, st)
    return {"id": it["id"], "status": it["status"], "title": it["title"]}


@mcp.tool()
def set_item(project: str, item_id: str, status: str = "", notes: str = "",
             title: str = "", agent: str = "") -> dict:
    """Update an item's status/notes/title. Use this to report something works or broken.

    IMPORTANT: setting status to `works` records that YOU (the agent) believe it
    works. It does not mark the item confirmed -- confirmation is the user's
    alone, and there is deliberately no MCP tool for it. If you have just fixed
    something, say so here and let the user confirm it in PlanIDE.
    """
    st, path = _resolve(project)
    fields = {}
    if agent:
        fields["claimed_by"] = agent
    if status:
        fields["status"] = status
    if notes:
        fields["notes"] = notes
    if title:
        fields["title"] = title
    it = store.update_item(st, item_id, **fields)
    store.save_state(path, st)
    return {"ok": it is not None, "item": it}


@mcp.tool()
def add_fix(project: str, title: str, problem: str = "", solution: str = "",
            agent: str = "", status: str = "open") -> dict:
    """Log a fix (problem -> solution). Set agent to your own name for attribution."""
    st, path = _resolve(project)
    fx = store.add_fix(st, title, problem, solution, "", agent, status)
    store.save_state(path, st)
    return {"id": fx["id"], "status": fx["status"], "title": fx["title"]}


@mcp.tool()
def mark_fixed(project: str, fix_id: str, solution: str = "") -> dict:
    """Mark a logged fix as fixed, optionally recording how you fixed it."""
    st, path = _resolve(project)
    fields = {"status": "fixed"}
    if solution:
        fields["solution"] = solution
    fx = store.update_fix(st, fix_id, **fields)
    store.save_state(path, st)
    return {"ok": fx is not None, "fix": fx}


@mcp.tool()
def add_milestone(project: str, title: str, target: str = "") -> dict:
    """Add a roadmap milestone."""
    st, path = _resolve(project)
    m = store.add_milestone(st, title, target)
    store.save_state(path, st)
    return {"id": m["id"], "title": m["title"]}


@mcp.tool()
def add_version(project: str, version: str, notes: str = "") -> dict:
    """Cut a new version (updates the project's current version + changelog)."""
    st, path = _resolve(project)
    v = store.add_version(st, version, notes)
    store.save_state(path, st)
    return {"version": v["version"], "date": v["date"]}


@mcp.tool()
def ai_report(project: str, mode: str = "full") -> str:
    """Get the AI briefing markdown (mode: full|report|prompt) for a project."""
    st, _ = _resolve(project)
    return aireport.build(st, mode)


@mcp.tool()
def detect_stack(path: str) -> dict:
    """Auto-detect the language/stack/type of a folder (no registration)."""
    return detect.detect(path)


if __name__ == "__main__":
    mcp.run()
