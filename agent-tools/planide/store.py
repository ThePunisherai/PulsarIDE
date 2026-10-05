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

import datetime as _dt
import math
import os
import re
import unicodedata

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
        # Your switches. auto_complete: work an agent reports working counts as
        # finished (`done`), with no one ticking it off by hand. Missing = on.
        "settings": {"auto_complete": True, "autopilot": True},
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
        it.setdefault("verified_by", "")
        it.setdefault("locked", False)
        it.setdefault("locked_at", "")
    # A fix with no status was logged by an IDE whose addFix dropped the
    # default: it was meant to be open, so it is -- same repair as store.ts.
    for fx in st.get("fixes", []):
        if fx.get("status") not in FIX_STATUSES:
            fx["status"] = "open"
    return st


def save_state(path: str, st: dict) -> None:
    # Agent work left in `works` is closed out in the same write while your
    # auto-complete is on -- the same rule the IDE and the MCP server apply.
    close_out_working(st)
    st["updated_at"] = now_iso()
    write_json(state_path(path), st)


# --------------------------------------------------------------------------- #
# auto-complete: what works is finished, with no one ticking it off by hand
# --------------------------------------------------------------------------- #
def auto_complete(st: dict) -> bool:
    """Your switch. On unless you turned it off; a board with no settings is on.

    Mirrors autoComplete() in tracker/mcp/work-queue.mjs and store.ts.
    """
    return (st.get("settings") or {}).get("auto_complete") is not False


def finished_status(st: dict, status: str) -> str:
    """Where an agent's "it works" lands: `done` with auto-complete on."""
    return "done" if status == "works" and auto_complete(st) else status


def close_out_working(st: dict) -> list:
    """Agent-reported `works` -> `done`. Never your own works, never a protected
    item; a confirmation is kept. Mirrors closeOutWorking() in work-queue.mjs."""
    if not auto_complete(st):
        return []
    closed = []
    at = now_iso()
    for it in st.get("items", []):
        if it.get("status") != "works" or it.get("locked") or not str(it.get("claimed_by") or "").strip():
            continue
        it["status"] = "done"
        it["updated_at"] = at
        closed.append(it)
    if closed:
        names = ", ".join(i["title"] for i in closed[:3]) + (", ..." if len(closed) > 3 else "")
        log_activity(st, "auto-complete",
                     "closed out %d working item(s): %s" % (len(closed), names), "auto")
    return closed


def autopilot(st: dict) -> bool:
    """Your second switch: agents keep working the board unasked (the
    keep-going hook). On unless you turned it off. Mirrors autopilot() in
    tracker/mcp/work-queue.mjs and store.ts."""
    return (st.get("settings") or {}).get("autopilot") is not False


def set_autopilot(st: dict, enabled: bool) -> bool:
    """Yours alone, like auto-complete."""
    st.setdefault("settings", {})["autopilot"] = bool(enabled)
    log_activity(st, "settings", "autopilot %s" % ("on" if enabled else "off"))
    return st["settings"]["autopilot"]


def set_auto_complete(st: dict, enabled: bool) -> bool:
    """Yours alone, like confirm and protect. Switching it on applies at once."""
    st.setdefault("settings", {})["auto_complete"] = bool(enabled)
    log_activity(st, "settings", "auto-complete %s" % ("on" if enabled else "off"))
    if enabled:
        close_out_working(st)
    return st["settings"]["auto_complete"]


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
    if claimed_by:
        status = finished_status(st, status)
    item = {
        "id": new_id("i_"), "title": title.strip() or "Untitled",
        "status": status, "notes": notes, "tags": tags or [],
        "priority": priority, "created_at": now_iso(), "updated_at": now_iso(),
        # Trust boundary: an agent can move `status`, never these.
        "claimed_by": claimed_by, "verified": False, "verified_at": "", "verified_by": "",
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
    # An agent saying it works (claimed_by given) lands as `done` while your
    # auto-complete is on. Without an agent name it is you, and stays as said.
    if fields.get("status") == "works" and fields.get("claimed_by"):
        fields = dict(fields, status=finished_status(st, "works"))
    for it in st["items"]:
        if it["id"] == item_id:
            for k, v in fields.items():
                if k in ("title", "status", "notes", "tags", "priority", "claimed_by"):
                    if k == "status" and v not in ITEM_STATUSES:
                        continue
                    if k == "status" and v != it.get("status") and it.get("verified"):
                        it["verified"] = False
                        it["verified_at"] = ""
                        it["verified_by"] = ""
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
            # Yours: confirming clears an agent's name, declining clears it entirely.
            it["verified_by"] = ""
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
    # One bug, one entry: the same open bug returns the entry already there,
    # with a new detail kept on it -- as the MCP server's add_fix does.
    if status == "open":
        for known in st.get("fixes", []):
            if known.get("status") == "open" and same_title(known.get("title"), title):
                if problem.strip() and problem.strip() not in (known.get("problem") or ""):
                    known["problem"] = ("%s\n%s" % (known["problem"], problem.strip())) if known.get("problem") else problem.strip()
                return dict(known, existing=True)
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
    # Yours only: an agent reporting works/done stamps its name in verified_by,
    # and counting that as your check is the bug the IDE already fixed.
    confirmed = sum(1 for i in working_items if i.get("verified") and not i.get("verified_by"))
    confirmed_pct = round(100 * confirmed / total) if total else 0
    # With your auto-complete on, everything that works counts as finished.
    auto = auto_complete(st)
    accepted = len(working_items) if auto else confirmed
    accepted_pct = _js_round(100 * accepted / total) if total else 0
    unconfirmed = len(working_items) - accepted
    by_agents = sum(1 for i in working_items
                    if not (i.get("verified") and not i.get("verified_by"))
                    and (i.get("claimed_by") or i.get("verified_by")))

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
    health = accepted_pct
    if total:
        health = max(0, min(100, round(accepted_pct - 8 * broken / max(1, total) * 10 / 10
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
        "auto_complete": auto,
        "autopilot": autopilot(st),
        "accepted": accepted,
        "accepted_percent": accepted_pct,
        "by_agents": by_agents,
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


# --------------------------------------------------------------------------- #
# the work order: finish wip, then todo, then open fixes, then broken
# --------------------------------------------------------------------------- #
# A port of tracker/mcp/work-queue.mjs, so a shell-only agent running `plan
# next` gets exactly what next_task gives an MCP agent. agent-tools/scripts/
# verify.sh runs both on the same board and compares them byte for byte.
STALE_HOURS = 3

_PRIORITY_RANK = {
    "urgent": 0, "critical": 0, "p0": 0, "blocker": 0,
    "high": 1, "p1": 1,
    "normal": 2, "medium": 2, "p2": 2, "": 2,
    "low": 3, "p3": 3, "someday": 3,
}

WORK_ORDER = (
    "Finish in_progress first, then todo in order, then open fixes, then broken items. "
    "A bug you hit mid-task goes on the board with add_fix (Fixes > Open) and waits its turn -- "
    "log it, do not switch to it. blocked waits on someone and is never picked."
)

_ACTION = {
    "in_progress": "Finish this first. Your plan for it becomes its checklist and closes it when every step "
                   "is done; or set_item it works/done in the same turn it genuinely works. Then call next_task again.",
    "todo": "Start this: next_task with claim=true (or set_item wip). Your plan for it becomes its checklist "
            "and closes it when every step is done; or set_item works/done.",
    "fix": "Fix this, verify it, then mark_fixed with the real solution -- what caused it and what changed.",
    "broken": "Make this work again, then set_item works. Log what caused it with add_fix if it was not "
              "logged yet.",
}


def _js_round(x: float) -> int:
    """Math.round, not Python's banker's rounding -- so both sides print the same."""
    return int(math.floor(x + 0.5))


def norm_title(value) -> str:
    """Case, spacing and punctuation ignored; letters in ANY script kept.

    Same as normTitle() in work-queue.mjs: an ASCII-only version erased every
    Cyrillic/CJK letter, so all such titles "matched" each other.
    """
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    kept = "".join(c if unicodedata.category(c)[0] in ("L", "N") else " " for c in text)
    return re.sub(r" +", " ", kept).strip()


def same_title(a, b) -> bool:
    ka = norm_title(a)
    return ka != "" and ka == norm_title(b)


def _lc(v) -> str:
    return str(v or "").strip().lower()


def _age_ms(iso: str, now_ms: float) -> float:
    try:
        raw = str(iso or "")
        if not raw:
            return math.inf
        t = _dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=_dt.timezone.utc)
        return max(0.0, now_ms - t.timestamp() * 1000)
    except (ValueError, TypeError):
        return math.inf


def _idle(ms: float) -> str:
    if not math.isfinite(ms):
        return "unknown"
    h = ms / 3600e3
    if h < 1:
        return "%dm" % max(1, _js_round(ms / 60e3))
    if h < 48:
        return "%dh" % _js_round(h)
    return "%dd" % _js_round(h / 24)


def _clip(s, n: int) -> str:
    t = re.sub(r"\s+", " ", str(s or "")).strip()
    return t[: n - 1] + "\u2026" if len(t) > n else t


def _item_card(i: dict, now_ms: float) -> dict:
    card = {"kind": "item", "id": i.get("id"), "title": i.get("title"), "status": i.get("status"),
            "claimed_by": i.get("claimed_by") or "", "idle": _idle(_age_ms(i.get("updated_at"), now_ms))}
    if i.get("locked"):
        card["locked"] = True
    return card


def _fix_card(f: dict) -> dict:
    return {"kind": "fix", "id": f.get("id"), "title": f.get("title"),
            "problem": _clip(f.get("problem"), 240), "logged_by": f.get("agent") or "",
            "created_at": f.get("created_at") or ""}


def work_queue(st: dict, agent: str = "", now_ms: float | None = None, limit: int = 5) -> dict:
    """What to work on now, in the board's fixed order. See work-queue.mjs."""
    now_ms = float(now_ms) if now_ms is not None else _dt.datetime.now(_dt.timezone.utc).timestamp() * 1000
    limit = limit if isinstance(limit, int) and limit > 0 else 5
    me = _lc(agent)
    stale_ms = STALE_HOURS * 3600e3
    items = st.get("items") or []
    fixes = st.get("fixes") or []

    wip_all = []
    for i in items:
        if i.get("status") != "wip":
            continue
        wip_all.append({"i": i, "age": _age_ms(i.get("updated_at"), now_ms),
                        "mine": bool(me) and _lc(i.get("claimed_by")) == me})

    def mine_to_finish(w):
        return (not me) or w["mine"] or not w["i"].get("claimed_by") or w["age"] >= stale_ms

    wip = []
    for w in sorted([w for w in wip_all if mine_to_finish(w)], key=lambda w: (-int(w["mine"]), -w["age"])):
        card = _item_card(w["i"], now_ms)
        if w["age"] >= stale_ms:
            card["stale"] = True
        wip.append(card)
    elsewhere = [_item_card(w["i"], now_ms) for w in wip_all if not mine_to_finish(w)]

    def rank(p):
        return _PRIORITY_RANK.get(_lc(p), _PRIORITY_RANK["normal"])

    todo = []
    for idx, i in sorted([(n, i) for n, i in enumerate(items) if i.get("status") == "todo"],
                         key=lambda t: (rank(t[1].get("priority")), str(t[1].get("created_at") or ""), t[0])):
        card = _item_card(i, now_ms)
        if rank(i.get("priority")) < 2:
            card["priority"] = i.get("priority")
        todo.append(card)

    open_fixes = [_fix_card(f) for _, f in sorted(
        [(n, f) for n, f in enumerate(fixes) if f.get("status") not in ("fixed", "wontfix")],
        key=lambda t: (str(t[1].get("created_at") or ""), t[0]))]

    broken = [_item_card(i, now_ms) for i in sorted(
        [i for i in items if i.get("status") == "broken"], key=lambda i: -int(bool(i.get("locked"))))]
    blocked = [_item_card(i, now_ms) for i in items if i.get("status") == "blocked"]
    regressed = [_item_card(i, now_ms) for i in items
                 if i.get("locked") and i.get("status") in ("broken", "blocked")]

    focus, phase = None, "clear"
    for lane, cards, ph in (("in_progress", wip, "finish"), ("todo", todo, "todo"),
                            ("fix", open_fixes, "fixes"), ("broken", broken, "fixes")):
        if cards:
            focus = dict({"lane": lane}, **cards[0])
            focus["action"] = _ACTION[lane]
            phase = ph
            break

    return {
        "phase": phase,
        "focus": focus,
        "alerts": ['REGRESSION: protected "%s" [%s] is %s -- tell the user before anything else.'
                   % (r["title"], r["id"], r["status"]) for r in regressed],
        "counts": {"in_progress": len(wip), "elsewhere": len(elsewhere), "todo": len(todo),
                   "open_fixes": len(open_fixes), "broken": len(broken), "blocked": len(blocked)},
        "in_progress": wip[:limit],
        "todo": todo[:limit],
        "open_fixes": open_fixes[:limit],
        "broken": broken[:limit],
        "blocked": blocked[:limit],
        "elsewhere": elsewhere[:limit],
        "order": WORK_ORDER,
    }


def claim_next(st: dict, agent: str = "") -> dict | None:
    """Take the focus item: todo -> wip under your name, or a left-over wip.

    Same rule as next_task(claim=true): a fix, your own wip, a protected item or
    nothing at all is not claimable, and nothing is written for it.
    """
    q = work_queue(st, agent)
    f = q["focus"]
    if not f or f.get("kind") != "item" or f.get("locked"):
        return None
    if f["lane"] == "in_progress" and not (agent and _lc(f.get("claimed_by")) != _lc(agent)):
        return None
    if f["lane"] not in ("todo", "in_progress"):
        return None
    for it in st.get("items", []):
        if it["id"] != f["id"]:
            continue
        before, previous = it["status"], it.get("claimed_by") or ""
        if before == "todo":
            it["status"] = "wip"
            if it.get("verified"):
                it["verified"], it["verified_at"], it["verified_by"] = False, "", ""
            log_activity(st, "item-status", "%s -> wip (picked up from the queue)" % it["title"], agent or "you")
        else:
            log_activity(st, "item-claim", ("%s: taken over from %s (left over)" % (it["title"], previous))
                         if previous else "%s: picked up (nobody was on it)" % it["title"], agent or "you")
        if agent:
            it["claimed_by"] = agent
        it["updated_at"] = now_iso()
        return {"id": it["id"], "title": it["title"], "from": before, "to": it["status"]}
    return None
