"""PlanIDE command-line interface:  python3 -m planide <command>

Commands
--------
  serve [--port N] [--no-browser]   start the web UI (http://127.0.0.1:8390)
  add <path> [name]                 register a project (auto-detects the stack)
  list                              list registered projects + progress
  detect <path>                     print the detected language/type
  report <path|id> [--mode M]       print the AI-ready briefing (M: full|report|prompt)
  backup <path|id> [label]          create a zip snapshot
  sync <path|id> [-m MSG] [--no-push]  git add/commit/(push)
  status <path|id>                  git status summary

A <path|id> argument accepts either a registered project id (p_...) or a
filesystem path (registered on the fly if new).
"""

from __future__ import annotations

import os
import sys

from . import store, detect as _detect, aireport, backup as _backup, gitsync, version


def _resolve(arg: str):
    """Return (state, path) for a project id or a path."""
    if arg.startswith("p_"):
        st, path = store.state_for(arg)
        return st, path
    path = os.path.abspath(os.path.expanduser(arg))
    # register if unknown
    known = {p["path"] for p in store.load_registry()}
    if path not in known:
        store.register(path)
    return store.load_state(path), path


def cmd_serve(argv):
    if "--no-browser" in argv:
        os.environ["PLANIDE_OPEN"] = "0"
    if "--port" in argv:
        os.environ["PLANIDE_PORT"] = argv[argv.index("--port") + 1]
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, here)
    import server  # noqa: E402  (server.py at repo root)
    server.main()


def cmd_add(argv):
    if not argv:
        print("usage: add <path> [name]"); return 1
    entry = store.register(argv[0], argv[1] if len(argv) > 1 else "")
    st = store.load_state(entry["path"])
    det = (st.get("stack") or {}).get("detected") or {}
    print("added: %s  [%s]  %s" % (entry["name"], st.get("type"),
                                   ", ".join(det.get("languages", []))))
    print("id: %s" % entry["id"])
    return 0


def cmd_list(argv):
    projects = store.load_registry()
    if not projects:
        print("no projects. add one:  python3 -m planide add <path>"); return 0
    for p in projects:
        s = store.summarise_project(p)
        pr = s.get("progress") or {}
        flag = "" if s.get("exists") else "  (MISSING)"
        print("%-14s %-22s %3d%%  %s v%s%s" % (
            p["id"], s.get("name", "")[:22], pr.get("percent", 0),
            s.get("type", "?"), s.get("version", "?"), flag))
    return 0


def cmd_detect(argv):
    if not argv:
        print("usage: detect <path>"); return 1
    d = _detect.detect(argv[0])
    print("type:       %s (%s)" % (d["type"], d["confidence"]))
    print("languages:  %s" % ", ".join(d["languages"]))
    print("stack:      %s" % ", ".join(d["stack"]))
    print("signals:    %s" % "; ".join(d["signals"]))
    return 0


def cmd_report(argv):
    if not argv:
        print("usage: report <path|id> [--mode full|report|prompt]"); return 1
    mode = "full"
    if "--mode" in argv:
        mode = argv[argv.index("--mode") + 1]
    st, _ = _resolve(argv[0])
    print(aireport.build(st, mode))
    return 0


def cmd_backup(argv):
    if not argv:
        print("usage: backup <path|id> [label]"); return 1
    st, path = _resolve(argv[0])
    r = _backup.create(path, st.get("version", ""), argv[1] if len(argv) > 1 else "")
    if r.get("ok"):
        print("snapshot: %s  (%d files, %s MB)" % (r["file"], r["files"], r["size_mb"]))
        return 0
    print("error: %s" % r.get("error")); return 1


def cmd_sync(argv):
    if not argv:
        print("usage: sync <path|id> [-m MSG] [--no-push]"); return 1
    msg = ""
    if "-m" in argv:
        msg = argv[argv.index("-m") + 1]
    push = "--no-push" not in argv
    _, path = _resolve(argv[0])
    r = gitsync.sync(path, msg, push)
    for line in r.get("log", []):
        print("  " + line)
    return 0 if r.get("ok") else 1


def cmd_status(argv):
    if not argv:
        print("usage: status <path|id>"); return 1
    _, path = _resolve(argv[0])
    g = gitsync.status(path)
    if not g.get("has_git"):
        print("not a git repo: %s" % path); return 0
    print("branch:   %s" % g.get("branch"))
    print("dirty:    %s (%d changed)" % (g.get("dirty"), g.get("changed_count", 0)))
    print("remote:   %s" % (g.get("remote") or "-"))
    print("ahead/behind: %d / %d" % (g.get("ahead", 0), g.get("behind", 0)))
    return 0


COMMANDS = {
    "serve": cmd_serve, "add": cmd_add, "list": cmd_list, "detect": cmd_detect,
    "report": cmd_report, "backup": cmd_backup, "sync": cmd_sync, "status": cmd_status,
}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print("PlanIDE %s -- project command deck" % version())
        print(__doc__)
        return 0
    cmd = argv[0]
    fn = COMMANDS.get(cmd)
    if not fn:
        print("unknown command: %s (try --help)" % cmd); return 2
    try:
        return fn(argv[1:]) or 0
    except KeyError as e:
        print("error: %s" % e); return 1


if __name__ == "__main__":
    raise SystemExit(main())
