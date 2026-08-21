"""PlanIDE agent CLI:  python3 -m planide <command>

This is how a shell-capable agent (Claude Code, Codex, ...) reads and updates
the tracker. It writes each project's own .planide/state.json directly -- there
is no server and no UI here; the UI lives inside PlanIDE itself.

Read commands
  list                                 list registered projects + progress
  detect <path>                        print the detected language/type
  board  <path|id>                     print the tracker board (item ids + status)
  report <path|id> [--mode M]          print the AI briefing (M: full|report|prompt)
  status <path|id>                     git status summary

Write commands  (this is how an AI agent tracks its own work)
  add <path> [name]                    register a project (auto-detects the stack)
  item add    <path|id> "title" [--status S] [--notes T] [--tags a,b] [--priority P]
  item set    <path|id> <item_id> [--status S] [--notes T] [--title T] [--agent A]
  item confirm   <path|id> <item_id>    mark as CONFIRMED-BY-YOU (agents cannot)
  item unconfirm <path|id> <item_id>    withdraw your confirmation
  item lock      <path|id> <item_id>    protect: DO NOT BREAK (agents cannot unlock)
  item unlock    <path|id> <item_id>    drop that protection
  activity <path|id> [n]                recent changes and who made them
  fix  add    <path|id> "title" [--problem P] [--solution S] [--agent A] [--status open]
  fix  done   <path|id> <fix_id> [--solution S]
  milestone add <path|id> "title" [--target T]
  version add   <path|id> <version> [--notes N]
  backup <path|id> [label]             create a zip snapshot
  sync   <path|id> [-m MSG] [--no-push] git add/commit/(push)

Item status: todo | wip | works | broken | blocked      Fix status: open | fixed | wontfix
A <path|id> is a registered id (p_...) or a filesystem path (registered on the fly).
"""

from __future__ import annotations

import os
import sys

from . import store, detect as _detect, aireport, backup as _backup, gitsync, version


def parse(argv, value_flags):
    """Split argv into positionals and --flags. value_flags take a value."""
    pos, opt, i = [], {}, 0
    while i < len(argv):
        a = argv[i]
        if a == "-m":  # alias for --message
            opt["message"] = argv[i + 1] if i + 1 < len(argv) else ""
            i += 2; continue
        if a.startswith("--"):
            name = a[2:]
            if name in value_flags:
                opt[name] = argv[i + 1] if i + 1 < len(argv) else ""
                i += 2
            else:
                opt[name] = True; i += 1
            continue
        pos.append(a); i += 1
    return pos, opt


def _resolve(arg: str):
    if arg.startswith("p_"):
        return store.state_for(arg)
    path = os.path.abspath(os.path.expanduser(arg))
    if path not in {p["path"] for p in store.load_registry()}:
        store.register(path)
    return store.load_state(path), path


def _save(st, path):
    store.save_state(path, st)


# --- read -------------------------------------------------------------------
def cmd_list(argv):
    projects = store.load_registry()
    if not projects:
        print("no projects. add one:  python3 -m planide add <path>"); return 0
    for p in projects:
        s = store.summarise_project(p); pr = s.get("progress") or {}
        flag = "" if s.get("exists") else "  (MISSING)"
        print("%-14s %-22s %3d%%  %s v%s%s" % (p["id"], s.get("name", "")[:22],
              pr.get("percent", 0), s.get("type", "?"), s.get("version", "?"), flag))
    return 0


def cmd_detect(argv):
    if not argv:
        print("usage: detect <path>"); return 1
    d = _detect.detect(argv[0])
    print("type:      %s (%s)" % (d["type"], d["confidence"]))
    print("languages: %s" % ", ".join(d["languages"]))
    print("stack:     %s" % ", ".join(d["stack"]))
    print("signals:   %s" % "; ".join(d["signals"]))
    return 0


def cmd_board(argv):
    if not argv:
        print("usage: board <path|id>"); return 1
    st, _ = _resolve(argv[0])
    print("%s  v%s  [%s]" % (st["name"], st.get("version"), st.get("type")))
    pr = store.progress(st)
    print("progress: %d%% working claimed (%d/%d) | %d%% CONFIRMED by you (%d) | "
          "%d broken, %d open fixes\n"
          % (pr["percent"], pr["done"], pr["total_items"], pr["confirmed_percent"],
             pr["confirmed"], pr["broken"], pr["open_fixes"]))
    reg = store.regressions(st)
    if reg:
        print("  !! REGRESSION: %d protected item(s) are broken:" % len(reg))
        for i in reg:
            print("     - %s" % i["title"])
        print()
    for it in st["items"]:
        mark = "OK " if it.get("verified") else ("?  " if it["status"] in ("works", "done") else "   ")
        lock = "[LOCKED]" if it.get("locked") else ""
        who = ("  <- %s" % it["claimed_by"]) if it.get("claimed_by") else ""
        print("  %s%-14s [%-7s] %s %s%s" % (mark, it["id"], it["status"], it["title"], lock, who))
    if st["fixes"]:
        print("\n  fixes:")
        for f in st["fixes"]:
            print("  %-14s [%-7s] %s" % (f["id"], f["status"], f["title"]))
    return 0


def cmd_activity(argv):
    if not argv:
        print("usage: activity <path|id> [n]"); return 1
    st, _ = _resolve(argv[0])
    n = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 20
    for a in st.get("activity", [])[:n]:
        print("  %s  %-8s %-12s %s" % (a["at"][5:16].replace("T", " "),
              a["who"][:8], a["kind"], a["text"]))
    return 0


def cmd_report(argv):
    pos, opt = parse(argv, {"mode"})
    if not pos:
        print("usage: report <path|id> [--mode full|report|prompt]"); return 1
    st, _ = _resolve(pos[0])
    print(aireport.build(st, opt.get("mode", "full")))
    return 0


def cmd_status(argv):
    if not argv:
        print("usage: status <path|id>"); return 1
    _, path = _resolve(argv[0])
    g = gitsync.status(path)
    if not g.get("has_git"):
        print("not a git repo: %s" % path); return 0
    print("branch: %s | dirty: %s (%d) | remote: %s | ahead/behind: %d/%d" % (
        g.get("branch"), g.get("dirty"), g.get("changed_count", 0),
        g.get("remote") or "-", g.get("ahead", 0), g.get("behind", 0)))
    return 0


# --- write ------------------------------------------------------------------
def cmd_add(argv):
    if not argv:
        print("usage: add <path> [name]"); return 1
    e = store.register(argv[0], argv[1] if len(argv) > 1 else "")
    st = store.load_state(e["path"])
    det = (st.get("stack") or {}).get("detected") or {}
    print("added: %s [%s] %s\nid: %s" % (e["name"], st.get("type"),
          ", ".join(det.get("languages", [])), e["id"]))
    return 0


def cmd_item(argv):
    if not argv:
        print("usage: item add|set|confirm|unconfirm …"); return 1
    sub, rest = argv[0], argv[1:]
    if sub == "add":
        pos, opt = parse(rest, {"status", "notes", "tags", "priority", "agent"})
        if len(pos) < 2:
            print('usage: item add <path|id> "title" [--status S] [--notes T] [--agent A]'); return 1
        st, path = _resolve(pos[0])
        it = store.add_item(st, pos[1], opt.get("status", "todo"), opt.get("notes", ""),
                            [t.strip() for t in opt.get("tags", "").split(",") if t.strip()],
                            opt.get("priority", "normal"), opt.get("agent", ""))
        _save(st, path); print("added item %s [%s]" % (it["id"], it["status"])); return 0
    if sub == "set":
        pos, opt = parse(rest, {"status", "notes", "title", "priority", "agent"})
        if len(pos) < 2:
            print("usage: item set <path|id> <item_id> [--status S] …"); return 1
        st, path = _resolve(pos[0])
        if "agent" in opt:
            opt["claimed_by"] = opt.pop("agent")
        fields = {k: v for k, v in opt.items()
                  if k in ("status", "notes", "title", "priority", "claimed_by")}
        it = store.update_item(st, pos[1], **fields)
        _save(st, path)
        print("updated %s -> %s" % (pos[1], it["status"]) if it else "no such item"); return 0 if it else 1
    if sub in ("lock", "unlock"):
        if len(rest) < 2:
            print("usage: item %s <path|id> <item_id>" % sub); return 1
        st, path = _resolve(rest[0])
        it = store.lock_item(st, rest[1], sub == "lock")
        _save(st, path)
        if not it:
            print("no such item"); return 1
        print("%s -> %s" % (rest[1],
              "PROTECTED (do not break)" if it["locked"] else "protection removed"))
        return 0
    if sub in ("confirm", "unconfirm"):
        # Your confirmation only -- no agent-facing surface reaches this.
        if len(rest) < 2:
            print("usage: item %s <path|id> <item_id>" % sub); return 1
        st, path = _resolve(rest[0])
        it = store.verify_item(st, rest[1], sub == "confirm")
        _save(st, path)
        if not it:
            print("no such item"); return 1
        print("%s -> %s" % (rest[1],
              "CONFIRMED by you" if it["verified"] else "confirmation withdrawn"))
        return 0
    print("usage: item add|set|confirm|unconfirm …"); return 1


def cmd_fix(argv):
    if not argv:
        print("usage: fix add|done …"); return 1
    sub, rest = argv[0], argv[1:]
    if sub == "add":
        pos, opt = parse(rest, {"problem", "solution", "agent", "status", "item"})
        if len(pos) < 2:
            print('usage: fix add <path|id> "title" [--problem P] [--solution S] [--agent A]'); return 1
        st, path = _resolve(pos[0])
        fx = store.add_fix(st, pos[1], opt.get("problem", ""), opt.get("solution", ""),
                           opt.get("item", ""), opt.get("agent", ""), opt.get("status", "open"))
        _save(st, path); print("added fix %s [%s]" % (fx["id"], fx["status"])); return 0
    if sub == "done":
        pos, opt = parse(rest, {"solution"})
        if len(pos) < 2:
            print("usage: fix done <path|id> <fix_id> [--solution S]"); return 1
        st, path = _resolve(pos[0])
        fields = {"status": "fixed"}
        if "solution" in opt:
            fields["solution"] = opt["solution"]
        fx = store.update_fix(st, pos[1], **fields)
        _save(st, path)
        print("fix %s -> fixed" % pos[1] if fx else "no such fix"); return 0 if fx else 1
    print("usage: fix add|done …"); return 1


def cmd_milestone(argv):
    if len(argv) < 2 or argv[0] != "add":
        print('usage: milestone add <path|id> "title" [--target T]'); return 1
    pos, opt = parse(argv[1:], {"target"})
    if len(pos) < 2:
        print('usage: milestone add <path|id> "title" [--target T]'); return 1
    st, path = _resolve(pos[0])
    m = store.add_milestone(st, pos[1], opt.get("target", ""))
    _save(st, path); print("added milestone %s" % m["id"]); return 0


def cmd_version(argv):
    if len(argv) < 2 or argv[0] != "add":
        print("usage: version add <path|id> <version> [--notes N]"); return 1
    pos, opt = parse(argv[1:], {"notes"})
    if len(pos) < 2:
        print("usage: version add <path|id> <version> [--notes N]"); return 1
    st, path = _resolve(pos[0])
    v = store.add_version(st, pos[1], opt.get("notes", ""))
    _save(st, path); print("cut version v%s" % v["version"]); return 0


def cmd_backup(argv):
    if not argv:
        print("usage: backup <path|id> [label]"); return 1
    st, path = _resolve(argv[0])
    r = _backup.create(path, st.get("version", ""), argv[1] if len(argv) > 1 else "")
    if r.get("ok"):
        print("snapshot: %s (%d files, %s MB)" % (r["file"], r["files"], r["size_mb"])); return 0
    print("error: %s" % r.get("error")); return 1


def cmd_sync(argv):
    pos, opt = parse(argv, {"message", "branch"})
    if not pos:
        print("usage: sync <path|id> [-m MSG] [--no-push]"); return 1
    _, path = _resolve(pos[0])
    r = gitsync.sync(path, opt.get("message", ""), not opt.get("no-push"), opt.get("branch", ""))
    for line in r.get("log", []):
        print("  " + line)
    return 0 if r.get("ok") else 1


COMMANDS = {
    "list": cmd_list, "detect": cmd_detect, "board": cmd_board,
    "report": cmd_report, "status": cmd_status, "add": cmd_add, "item": cmd_item,
    "fix": cmd_fix, "milestone": cmd_milestone, "version": cmd_version,
    "backup": cmd_backup, "sync": cmd_sync, "activity": cmd_activity,
}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print("PlanIDE %s -- project command deck" % version()); print(__doc__); return 0
    fn = COMMANDS.get(argv[0])
    if not fn:
        print("unknown command: %s (try --help)" % argv[0]); return 2
    try:
        return fn(argv[1:]) or 0
    except KeyError as e:
        print("error: %s" % e); return 1


if __name__ == "__main__":
    raise SystemExit(main())
