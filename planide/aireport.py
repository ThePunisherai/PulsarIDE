"""Generate an AI-ready briefing from a project's tracker state.

This is the "output naar AI" / orca-mix feature: turn the board (works / broken),
the fix log, the roadmap and the version history into one structured Markdown
document you can paste straight into Claude, Codex, or any coding agent -- ending
with a concrete "Ask" so the agent knows what to actually do.

The document is deterministic (same state -> same text) and self-contained.
"""

from __future__ import annotations

from .store import progress

_STATUS_ICON = {
    "works": "[OK]", "broken": "[BROKEN]", "blocked": "[BLOCKED]",
    "wip": "[WIP]", "todo": "[TODO]",
}


def _bullets(items, key="title", extra=None):
    out = []
    for it in items:
        line = "- " + str(it.get(key, "")).strip()
        if extra:
            ex = extra(it)
            if ex:
                line += " -- " + ex
        out.append(line)
    return out


def build(st: dict, mode: str = "full") -> str:
    """mode: 'full' (report + ask) | 'report' (status only) | 'prompt' (ask-heavy)."""
    p = progress(st)
    items = st.get("items", [])
    fixes = st.get("fixes", [])
    roadmap = st.get("roadmap", [])
    versions = st.get("versions", [])
    det = (st.get("stack") or {}).get("detected") or {}
    custom = (st.get("stack") or {}).get("custom", "")

    works = [i for i in items if i.get("status") == "works"]
    broken = [i for i in items if i.get("status") in ("broken", "blocked")]
    wip = [i for i in items if i.get("status") == "wip"]
    todo = [i for i in items if i.get("status") == "todo"]
    open_fixes = [f for f in fixes if f.get("status") == "open"]
    done_fixes = [f for f in fixes if f.get("status") == "fixed"]

    langs = ", ".join(det.get("languages", [])) or "unknown"
    stack = ", ".join(det.get("stack", [])) or "-"
    if custom:
        stack = (stack + ", " if stack != "-" else "") + custom

    L = []
    L.append("# %s -- project briefing" % st.get("name", "project"))
    L.append("")
    L.append("- **Type**: %s" % st.get("type", "custom"))
    L.append("- **Languages**: %s" % langs)
    L.append("- **Stack**: %s" % stack)
    L.append("- **Version**: %s" % p["version"])
    L.append("- **Progress**: %d%% of tracked items working (%d/%d) -- health %d/100"
             % (p["percent"], p["done"], p["total_items"], p["health"]))
    L.append("- **Open problems**: %d broken/blocked, %d open fixes"
             % (p["broken"], p["open_fixes"]))
    L.append("")

    L.append("## What works")
    L.extend(_bullets(works) or ["- (nothing marked working yet)"])
    L.append("")

    L.append("## What is broken / blocked")
    if broken:
        L.extend(_bullets(
            broken,
            extra=lambda it: (("%s " % _STATUS_ICON.get(it.get("status"), ""))
                              + (it.get("notes", "") or "")).strip()))
    else:
        L.append("- (nothing currently marked broken)")
    L.append("")

    if wip or todo:
        L.append("## In progress / planned")
        L.extend(_bullets(wip, extra=lambda it: "WIP"))
        L.extend(_bullets(todo, extra=lambda it: "todo"))
        L.append("")

    L.append("## Open fixes (need attention)")
    if open_fixes:
        for f in open_fixes:
            L.append("- **%s**" % f.get("title", "fix"))
            if f.get("problem"):
                L.append("  - problem: %s" % f["problem"])
            if f.get("solution"):
                L.append("  - proposed: %s" % f["solution"])
            if f.get("agent"):
                L.append("  - assigned: %s" % f["agent"])
    else:
        L.append("- (no open fixes logged)")
    L.append("")

    if done_fixes:
        L.append("## Recently fixed")
        for f in done_fixes[:12]:
            line = "- **%s**" % f.get("title", "fix")
            if f.get("solution"):
                line += " -- %s" % f["solution"]
            L.append(line)
        L.append("")

    if roadmap:
        L.append("## Roadmap (%d%% of milestones done)" % p["milestones_percent"])
        for m in sorted(roadmap, key=lambda x: x.get("order", 0)):
            box = "[x]" if m.get("done") else "[ ]"
            tgt = (" (target: %s)" % m["target"]) if m.get("target") else ""
            L.append("- %s %s%s" % (box, m.get("title", ""), tgt))
        L.append("")

    if versions:
        L.append("## Version history")
        for v in versions[:8]:
            L.append("### v%s -- %s" % (v.get("version", "?"), v.get("date", "")))
            if v.get("notes"):
                L.append(v["notes"])
            for label, key in (("Added", "added"), ("Fixed", "fixed"),
                               ("Changed", "changed")):
                vals = v.get(key) or []
                if vals:
                    L.append("- %s: %s" % (label, "; ".join(vals)))
        L.append("")

    if mode in ("full", "prompt"):
        L.append("## Ask")
        if broken or open_fixes:
            L.append("Please help resolve the broken items and open fixes above. "
                     "For each one:")
            L.append("1. Diagnose the root cause (don't guess -- inspect the code).")
            L.append("2. Propose a minimal fix and apply it.")
            L.append("3. Tell me exactly what changed and how to verify it works.")
            L.append("")
            L.append("When an item is resolved, note it so I can mark it fixed in "
                     "PlanIDE and log the solution.")
        else:
            L.append("Everything tracked is currently working. Suggest the next "
                     "highest-value milestone from the roadmap and how to approach it.")
        L.append("")

    L.append("---")
    L.append("_Generated by PlanIDE %s_" % st.get("version", ""))
    return "\n".join(L)
