"""Project registry + per-project tracker state.

The registry (central) just remembers which folders you added. The real data
lives per-project in <project>/.planide/state.json so it travels with the code.

A state document looks like::

    {
      "id", "name", "path", "type", "stack": {...}, "version",
      "created_at", "updated_at",
      "items":   [ {id,title,status,notes,tags,priority,created_at,updated_at} ],
      "fixes":   [ {id,item_id,title,problem,solution,status,agent,created_at,fixed_at} ],
      "roadmap": [ {id,title,target,done,order,item_ids} ],
      "versions":[ {version,date,notes,added,fixed,changed} ],
      "github":  {remote,branch,lfs,auto_push,last_sync},
      "backups": [ {file,created_at,size} ]
    }

Item status vocabulary : todo | wip | works | broken | blocked
Fix status vocabulary  : open | fixed | wontfix
"""

from __future__ import annotations

import os

from . import (
    detect as _detect,
    new_id,
    now_iso,
    read_json,
    registry_path,
    state_path,
    version as _pkg_version,
    write_json,
)

# Two orthogonal axes, deliberately not merged:
#   status  -- what state the thing is in (anyone, including agents, may move it)
#   flags   -- `verified` and `locked`, which ONLY you may set (see verify_item /
#              lock_item). An agent can read them, never write them.
ITEM_STATUSES = ["todo", "wip", "works", "broken", "blocked", "done"]
FIX_STATUSES = ["open", "fixed", "wontfix"]

# statuses that count as "done" for progress purposes
# "works" = it functions. "done" = finished and closed out. Both count as
# working software; only `done` counts as complete.
DONE_ITEM = {"works", "done"}
COMPLETE_ITEM = {"done"}
OPEN_ITEM = {"todo", "wip"}
OPEN_BAD = {"broken", "blocked"}


# --------------------------------------------------------------------------- #
# registry
# --------------------------------------------------------------------------- #
def load_registry() -> list:
    reg = read_json(registry_path(), {"projects": []})
    return reg.get("projects", []) if isinstance(reg, dict) else []


def save_registry(projects: list) -> None:
    write_json(registry_path(), {"projects": projects})


def register(path: str, name: str = "") -> dict:
    """Add a project folder to the registry and initialise its state file."""
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(path):
        raise ValueError("not a directory: %s" % path)
    projects = load_registry()
    for p in projects:
        if p.get("path") == path:
            # already known -- make sure state exists, return it
            load_state(path)
            return p
    pid = new_id("p_")
    entry = {"id": pid, "path": path, "name": name or os.path.basename(path.rstrip("/"))}
    projects.append(entry)
    save_registry(projects)
    # create the per-project state (auto-detect on first add)
    st = load_state(path)
    st["name"] = entry["name"]
    st["id"] = pid
    det = _detect.detect(path)
    st["type"] = det["type"]
    st["stack"] = {"detected": det, "custom": ""}
    save_state(path, st)
    return entry


def unregister(project_id: str) -> bool:
    projects = load_registry()
    keep = [p for p in projects if p.get("id") != project_id]
    if len(keep) == len(projects):
        return False
    save_registry(keep)
    return True


def find(project_id: str) -> dict | None:
    for p in load_registry():
        if p.get("id") == project_id:
            return p
    return None


# --------------------------------------------------------------------------- #
# per-project state
# --------------------------------------------------------------------------- #
def _blank_state(path: str) -> dict:
    return {
        "id": new_id("p_"),
        "name": os.path.basename(path.rstrip("/")),
        "path": path,
        "type": "custom",
        "stack": {"detected": {}, "custom": ""},
        "version": "0.1.0",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "items": [],
        "fixes": [],
        "roadmap": [],
        "versions": [],
        "github": {"remote": "", "branch": "main", "lfs": False,
                   "auto_push": False, "last_sync": ""},
        "backups": [],
        # Append-only trail of what changed and who changed it. Capped in
        # log_activity() so a long-lived project never grows an unbounded file.
        "activity": [],
    }


ACTIVITY_CAP = 400


def log_activity(st: dict, kind: str, text: str, who: str = "you") -> dict:
    """Record a change. `who` is "you" for your own actions, otherwise the agent."""
    entry = {"id": new_id("a_"), "at": now_iso(), "kind": kind,
             "text": text, "who": who or "you"}
    st.setdefault("activity", []).insert(0, entry)
    del st["activity"][ACTIVITY_CAP:]
    return entry


def load_state(path: str) -> dict:
    path = os.path.abspath(os.path.expanduser(path))
    st = read_json(state_path(path), None)
    if not isinstance(st, dict):
        st = _blank_state(path)
        write_json(state_path(path), st)
    # keep path fresh (folder may have moved)
    st["path"] = path
    # forward-compat: make sure all keys exist
    for k, v in _blank_state(path).items():
        st.setdefault(k, v)
    # forward-compat: items predating the confirmation layer are "unconfirmed".
    for it in st.get("items", []):
        it.setdefault("claimed_by", "")
        it.setdefault("verified", False)
        it.setdefault("verified_at", "")
        it.setdefault("locked", False)
        it.setdefault("locked_at", "")
    return st


def save_state(path: str, st: dict) -> None:
    st["updated_at"] = now_iso()
    write_json(state_path(path), st)


def state_for(project_id: str) -> tuple[dict, str]:
    entry = find(project_id)
    if not entry:
        raise KeyError("unknown project id: %s" % project_id)
    path = entry["path"]
    return load_state(path), path


# --------------------------------------------------------------------------- #
# items (the works/broken tracker board)
# --------------------------------------------------------------------------- #
def add_item(st: dict, title: str, status: str = "todo", notes: str = "",
             tags=None, priority: str = "normal", claimed_by: str = "") -> dict:
    """Add a tracker item.

    `claimed_by` records WHO said this — an agent name when an agent reports it,
    empty when you entered it yourself. It never implies the claim is true: see
    verify_item() for the confirmation this project deliberately keeps separate.
    """
    if status not in ITEM_STATUSES:
        status = "todo"
    item = {
        "id": new_id("i_"), "title": title.strip() or "Untitled",
        "status": status, "notes": notes, "tags": tags or [],
        "priority": priority, "created_at": now_iso(), "updated_at": now_iso(),
        # Trust boundary: an agent can move `status`, never these.
        "claimed_by": claimed_by, "verified": False, "verified_at": "",
        # `locked` = "this must not break": load-bearing work you have protected.
        "locked": False, "locked_at": "",
    }
    st["items"].append(item)
    log_activity(st, "item-add", "added %s (%s)" % (item["title"], status),
                 claimed_by or "you")
    return item


def update_item(st: dict, item_id: str, **fields) -> dict | None:
    """Update an item's own fields.

    Deliberately cannot set `verified`: confirmation is yours alone, and an
    agent calling this must not be able to mark its own work as confirmed.
    Changing the status of a confirmed item drops the confirmation, because what
    you confirmed is no longer what the item says.
    """
    for it in st["items"]:
        if it["id"] == item_id:
            for k, v in fields.items():
                if k in ("title", "status", "notes", "tags", "priority", "claimed_by"):
                    if k == "status" and v not in ITEM_STATUSES:
                        continue
                    if k == "status" and v != it.get("status") and it.get("verified"):
                        it["verified"] = False
                        it["verified_at"] = ""
                    it[k] = v
            it["updated_at"] = now_iso()
            if "status" in fields:
                who = fields.get("claimed_by") or it.get("claimed_by") or "you"
                note = " (was protected -- REGRESSION)" if (
                    it.get("locked") and it["status"] in OPEN_BAD) else ""
                log_activity(st, "item-status",
                             "%s -> %s%s" % (it["title"], it["status"], note), who)
            return it
    return None


def lock_item(st: dict, item_id: str, locked: bool = True) -> dict | None:
    """Protect an item: "this works and must NOT be broken".

    Like verification this is yours alone -- an agent must never be able to
    unprotect the thing it is about to refactor. Agents can READ the flag (they
    need to know what is off-limits), and the AI briefing calls it out loudly.
    """
    for it in st["items"]:
        if it["id"] == item_id:
            it["locked"] = bool(locked)
            it["locked_at"] = now_iso() if locked else ""
            it["updated_at"] = now_iso()
            log_activity(st, "lock",
                         "%s %s" % ("protected" if locked else "unprotected",
                                    it["title"]))
            return it
    return None


def regressions(st: dict) -> list:
    """Protected items that are no longer working -- the alarm that matters."""
    return [i for i in st.get("items", [])
            if i.get("locked") and i.get("status") in OPEN_BAD]


def verify_item(st: dict, item_id: str, verified: bool = True) -> dict | None:
    """Confirm (or un-confirm) an item yourself.

    This is the only way `verified` is ever set, and it is intentionally NOT
    reachable from the MCP tools an agent uses -- "an agent says it works" and
    "you saw it work" must never collapse into the same signal.
    """
    for it in st["items"]:
        if it["id"] == item_id:
            it["verified"] = bool(verified)
            it["verified_at"] = now_iso() if verified else ""
            it["updated_at"] = now_iso()
            log_activity(st, "verify",
                         "%s %s" % ("confirmed" if verified else "unconfirmed",
                                    it["title"]))
            return it
    return None


def delete_item(st: dict, item_id: str) -> bool:
    before = len(st["items"])
    st["items"] = [i for i in st["items"] if i["id"] != item_id]
    # detach from roadmap milestones
    for m in st["roadmap"]:
        if item_id in m.get("item_ids", []):
            m["item_ids"].remove(item_id)
    return len(st["items"]) != before


# --------------------------------------------------------------------------- #
# fixes (the AI / orca-style fix log)
# --------------------------------------------------------------------------- #
def add_fix(st: dict, title: str, problem: str = "", solution: str = "",
            item_id: str = "", agent: str = "", status: str = "open") -> dict:
    if status not in FIX_STATUSES:
        status = "open"
    fix = {
        "id": new_id("f_"), "title": title.strip() or "Untitled fix",
        "problem": problem, "solution": solution, "item_id": item_id,
        "agent": agent, "status": status, "created_at": now_iso(),
        "fixed_at": now_iso() if status == "fixed" else "",
    }
    st["fixes"].append(fix)
    log_activity(st, "fix-add", "logged fix: %s" % fix["title"], agent or "you")
    return fix


def update_fix(st: dict, fix_id: str, **fields) -> dict | None:
    for fx in st["fixes"]:
        if fx["id"] == fix_id:
            for k, v in fields.items():
                if k in ("title", "problem", "solution", "item_id", "agent", "status"):
                    if k == "status" and v not in FIX_STATUSES:
                        continue
                    fx[k] = v
            if fields.get("status") == "fixed" and not fx.get("fixed_at"):
                fx["fixed_at"] = now_iso()
                log_activity(st, "fix-done", "fixed: %s" % fx["title"],
                             fx.get("agent") or "you")
            return fx
    return None


def delete_fix(st: dict, fix_id: str) -> bool:
    before = len(st["fixes"])
    st["fixes"] = [f for f in st["fixes"] if f["id"] != fix_id]
    return len(st["fixes"]) != before


# --------------------------------------------------------------------------- #
# roadmap milestones
# --------------------------------------------------------------------------- #
def add_milestone(st: dict, title: str, target: str = "", item_ids=None) -> dict:
    m = {
        "id": new_id("m_"), "title": title.strip() or "Milestone",
        "target": target, "done": False,
        "order": len(st["roadmap"]), "item_ids": item_ids or [],
    }
    st["roadmap"].append(m)
    return m


def update_milestone(st: dict, mid: str, **fields) -> dict | None:
    for m in st["roadmap"]:
        if m["id"] == mid:
            for k, v in fields.items():
                if k in ("title", "target", "done", "order", "item_ids"):
                    m[k] = v
            return m
    return None


def delete_milestone(st: dict, mid: str) -> bool:
    before = len(st["roadmap"])
    st["roadmap"] = [m for m in st["roadmap"] if m["id"] != mid]
    return len(st["roadmap"]) != before


# --------------------------------------------------------------------------- #
# versions / changelog
# --------------------------------------------------------------------------- #
def add_version(st: dict, version_str: str, notes: str = "", added=None,
                fixed=None, changed=None, set_current: bool = True) -> dict:
    entry = {
        "version": version_str.strip() or st.get("version", "0.1.0"),
        "date": now_iso(), "notes": notes,
        "added": added or [], "fixed": fixed or [], "changed": changed or [],
    }
    st["versions"].insert(0, entry)  # newest first
    if set_current:
        st["version"] = entry["version"]
    return entry


# --------------------------------------------------------------------------- #
# progress / rollups
# --------------------------------------------------------------------------- #
def progress(st: dict) -> dict:
    items = st.get("items", [])
    total = len(items)
    counts = {s: 0 for s in ITEM_STATUSES}
    for it in items:
        counts[it.get("status", "todo")] = counts.get(it.get("status", "todo"), 0) + 1
    done = sum(counts.get(s, 0) for s in DONE_ITEM)
    broken = sum(counts.get(s, 0) for s in OPEN_BAD)
    pct = round(100 * done / total) if total else 0

    # Two different truths, deliberately never merged into one number:
    #   done      -- items whose status says "works" (often an agent's claim)
    #   confirmed -- items YOU confirmed actually work
    working_items = [i for i in items if i.get("status") in DONE_ITEM]
    confirmed = sum(1 for i in working_items if i.get("verified"))
    unconfirmed = len(working_items) - confirmed
    confirmed_pct = round(100 * confirmed / total) if total else 0

    complete = sum(1 for i in items if i.get("status") in COMPLETE_ITEM)
    open_work = sum(1 for i in items if i.get("status") in OPEN_ITEM)
    protected = sum(1 for i in items if i.get("locked"))
    regressed = len(regressions(st))

    fixes = st.get("fixes", [])
    open_fixes = sum(1 for f in fixes if f.get("status") == "open")
    fixed = sum(1 for f in fixes if f.get("status") == "fixed")

    milestones = st.get("roadmap", [])
    ms_done = sum(1 for m in milestones if m.get("done"))
    ms_pct = round(100 * ms_done / len(milestones)) if milestones else 0

    # Health is scored on CONFIRMED work, not on claims: a project where every
    # item is "works" but nothing is confirmed is not a healthy project, it is
    # an unverified one.
    health = confirmed_pct
    if total:
        health = max(0, min(100, round(confirmed_pct - 8 * broken / max(1, total) * 10 / 10
                                       - 4 * open_fixes
                                       # A protected item breaking is a regression:
                                       # the loudest possible signal.
                                       - 15 * regressed)))
    return {
        "total_items": total,
        "counts": counts,
        "done": done,
        "confirmed": confirmed,
        "unconfirmed": unconfirmed,
        "confirmed_percent": confirmed_pct,
        "complete": complete,
        "open": open_work,
        "protected": protected,
        "regressed": regressed,
        "broken": broken,
        "percent": pct,
        "open_fixes": open_fixes,
        "fixed": fixed,
        "milestones_total": len(milestones),
        "milestones_done": ms_done,
        "milestones_percent": ms_pct,
        "health": health,
        "version": st.get("version", "0.1.0"),
    }


def summarise_project(entry: dict) -> dict:
    """Registry entry + a light rollup for the projects list view."""
    path = entry.get("path", "")
    exists = os.path.isdir(path)
    out = dict(entry)
    out["exists"] = exists
    if not exists:
        out["progress"] = {}
        return out
    st = load_state(path)
    out["name"] = st.get("name", entry.get("name", ""))
    out["type"] = st.get("type", "custom")
    det = (st.get("stack") or {}).get("detected") or {}
    out["languages"] = det.get("languages", [])
    out["custom_stack"] = (st.get("stack") or {}).get("custom", "")
    out["progress"] = progress(st)
    out["version"] = st.get("version", "0.1.0")
    out["github"] = st.get("github", {})
    return out


def pkg_version() -> str:
    return _pkg_version()
