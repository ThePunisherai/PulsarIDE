#!/usr/bin/env python3
"""PlanIDE -- local project command deck (web UI + JSON API).

Zero dependencies: Python standard library only. Run it and open the URL::

    python3 server.py                 # foreground, http://127.0.0.1:8390
    PLANIDE_PORT=9100 python3 server.py

It serves a single-page app (static/) and a small JSON API backed by the
`planide` package (detect / store / gitsync / backup / aireport).

Security: this is a *local* tool. State-changing POSTs are rejected when they
carry a browser Origin header that is not this server's own host+port, which
blocks cross-site (CSRF) requests from any other tab while still letting curl,
the CLI and same-origin fetches through (they send no Origin, or a matching one).
"""

from __future__ import annotations

import json
import os
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from planide import store, gitsync, backup, aireport, detect, version  # noqa: E402

PORT = int(os.environ.get("PLANIDE_PORT", "8390"))
HOST = os.environ.get("PLANIDE_HOST", "127.0.0.1")
ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
}


# --------------------------------------------------------------------------- #
# read-only rollups
# --------------------------------------------------------------------------- #
def overview() -> dict:
    projects = [store.summarise_project(p) for p in store.load_registry()]
    total_items = sum((p.get("progress") or {}).get("total_items", 0) for p in projects)
    broken = sum((p.get("progress") or {}).get("broken", 0) for p in projects)
    open_fixes = sum((p.get("progress") or {}).get("open_fixes", 0) for p in projects)
    return {
        "version": version(),
        "projects": projects,
        "count": len(projects),
        "total_items": total_items,
        "broken": broken,
        "open_fixes": open_fixes,
    }


def project_detail(pid: str) -> dict:
    st, path = store.state_for(pid)
    st = dict(st)
    st["progress"] = store.progress(st)
    st["git"] = gitsync.status(path)
    st["backups"] = backup.listing(path)
    return st


def browse(path: str) -> dict:
    """List sub-directories under `path` so the UI can pick a project folder."""
    path = os.path.abspath(os.path.expanduser(path or os.path.expanduser("~")))
    if not os.path.isdir(path):
        return {"ok": False, "error": "not a directory", "path": path}
    dirs = []
    try:
        for name in sorted(os.listdir(path)):
            fp = os.path.join(path, name)
            if os.path.isdir(fp) and not name.startswith("."):
                dirs.append({"name": name, "path": fp})
    except OSError as e:
        return {"ok": False, "error": str(e), "path": path}
    parent = os.path.dirname(path.rstrip("/")) or path
    return {"ok": True, "path": path, "parent": parent, "dirs": dirs[:400],
            "detected": detect.detect(path)}


class Handler(BaseHTTPRequestHandler):
    server_version = "PlanIDE"

    # -- helpers ----------------------------------------------------------- #
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _cross_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return False  # non-browser or same-origin fetch
        allowed = {"http://%s:%d" % (HOST, PORT), "http://127.0.0.1:%d" % PORT,
                   "http://localhost:%d" % PORT}
        return origin not in allowed

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def log_message(self, *args):  # silence default noisy logging
        pass

    def _static(self, path: str):
        if path == "/" or path == "":
            path = "/index.html"
        if ".." in path:
            self._json({"error": "bad path"}, 400)
            return
        fp = os.path.join(STATIC, path.lstrip("/"))
        if not os.path.isfile(fp):
            fp = os.path.join(STATIC, "index.html")  # SPA fallback
        ext = os.path.splitext(fp)[1].lower()
        try:
            with open(fp, "rb") as fh:
                data = fh.read()
        except OSError:
            self._json({"error": "not found"}, 404)
            return
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # -- GET --------------------------------------------------------------- #
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)

        def arg(name, default=""):
            return (q.get(name) or [default])[0]

        try:
            if not path.startswith("/api/"):
                return self._static(path)
            if path == "/api/overview":
                return self._json(overview())
            if path == "/api/project":
                return self._json(project_detail(arg("id")))
            if path == "/api/detect":
                return self._json(detect.detect(arg("path")))
            if path == "/api/browse":
                return self._json(browse(arg("path")))
            if path == "/api/git/status":
                _, p = store.state_for(arg("id"))
                return self._json(gitsync.status(p))
            if path == "/api/git/large-files":
                _, p = store.state_for(arg("id"))
                mb = float(arg("mb", "50") or 50)
                return self._json(gitsync.large_files(p, mb))
            if path == "/api/backups":
                _, p = store.state_for(arg("id"))
                return self._json({"backups": backup.listing(p)})
            if path == "/api/ai-report":
                st, _ = store.state_for(arg("id"))
                md = aireport.build(st, arg("mode", "full") or "full")
                return self._json({"markdown": md})
            return self._json({"error": "unknown endpoint"}, 404)
        except KeyError as e:
            return self._json({"error": str(e)}, 404)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:  # noqa: BLE001  -- never crash the request thread
            return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 500)

    # -- POST -------------------------------------------------------------- #
    def do_POST(self):
        if self._cross_origin():
            return self._json({"error": "cross-origin request refused"}, 403)
        parsed = urlparse(self.path)
        path = parsed.path
        b = self._body()
        try:
            return self._route_post(path, b)
        except KeyError as e:
            return self._json({"error": str(e)}, 404)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:  # noqa: BLE001
            return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 500)

    def _with_state(self, b):
        st, p = store.state_for(b.get("id", ""))
        return st, p

    def _route_post(self, path, b):
        # ---- projects ---------------------------------------------------- #
        if path == "/api/project/add":
            entry = store.register(b.get("path", ""), b.get("name", ""))
            return self._json({"ok": True, "project": entry})
        if path == "/api/project/remove":
            return self._json({"ok": store.unregister(b.get("id", ""))})
        if path == "/api/project/redetect":
            st, p = self._with_state(b)
            det = detect.detect(p)
            st["type"] = det["type"]
            st.setdefault("stack", {})["detected"] = det
            store.save_state(p, st)
            return self._json({"ok": True, "detected": det})
        if path == "/api/project/set-type":
            st, p = self._with_state(b)
            st["type"] = (b.get("type") or "custom").strip()
            store.save_state(p, st)
            return self._json({"ok": True, "type": st["type"]})
        if path == "/api/project/set-custom-stack":
            st, p = self._with_state(b)
            st.setdefault("stack", {})["custom"] = b.get("custom", "")
            store.save_state(p, st)
            return self._json({"ok": True})

        # ---- items ------------------------------------------------------- #
        if path == "/api/item/add":
            st, p = self._with_state(b)
            it = store.add_item(st, b.get("title", ""), b.get("status", "todo"),
                                b.get("notes", ""), b.get("tags"),
                                b.get("priority", "normal"))
            store.save_state(p, st)
            return self._json({"ok": True, "item": it})
        if path == "/api/item/update":
            st, p = self._with_state(b)
            it = store.update_item(st, b.get("item_id", ""),
                                   **{k: b[k] for k in ("title", "status", "notes",
                                      "tags", "priority") if k in b})
            store.save_state(p, st)
            return self._json({"ok": it is not None, "item": it})
        if path == "/api/item/delete":
            st, p = self._with_state(b)
            ok = store.delete_item(st, b.get("item_id", ""))
            store.save_state(p, st)
            return self._json({"ok": ok})

        # ---- fixes ------------------------------------------------------- #
        if path == "/api/fix/add":
            st, p = self._with_state(b)
            fx = store.add_fix(st, b.get("title", ""), b.get("problem", ""),
                               b.get("solution", ""), b.get("item_id", ""),
                               b.get("agent", ""), b.get("status", "open"))
            store.save_state(p, st)
            return self._json({"ok": True, "fix": fx})
        if path == "/api/fix/update":
            st, p = self._with_state(b)
            fx = store.update_fix(st, b.get("fix_id", ""),
                                  **{k: b[k] for k in ("title", "problem", "solution",
                                     "item_id", "agent", "status") if k in b})
            store.save_state(p, st)
            return self._json({"ok": fx is not None, "fix": fx})
        if path == "/api/fix/delete":
            st, p = self._with_state(b)
            ok = store.delete_fix(st, b.get("fix_id", ""))
            store.save_state(p, st)
            return self._json({"ok": ok})

        # ---- roadmap ----------------------------------------------------- #
        if path == "/api/milestone/add":
            st, p = self._with_state(b)
            m = store.add_milestone(st, b.get("title", ""), b.get("target", ""),
                                    b.get("item_ids"))
            store.save_state(p, st)
            return self._json({"ok": True, "milestone": m})
        if path == "/api/milestone/update":
            st, p = self._with_state(b)
            m = store.update_milestone(st, b.get("mid", ""),
                                       **{k: b[k] for k in ("title", "target", "done",
                                          "order", "item_ids") if k in b})
            store.save_state(p, st)
            return self._json({"ok": m is not None, "milestone": m})
        if path == "/api/milestone/delete":
            st, p = self._with_state(b)
            ok = store.delete_milestone(st, b.get("mid", ""))
            store.save_state(p, st)
            return self._json({"ok": ok})

        # ---- versions ---------------------------------------------------- #
        if path == "/api/version/add":
            st, p = self._with_state(b)
            v = store.add_version(st, b.get("version", ""), b.get("notes", ""),
                                  b.get("added"), b.get("fixed"), b.get("changed"))
            store.save_state(p, st)
            return self._json({"ok": True, "version": v})

        # ---- git --------------------------------------------------------- #
        if path == "/api/git/init":
            st, p = self._with_state(b)
            r = gitsync.init(p, b.get("branch", "main"))
            st.setdefault("github", {})["branch"] = b.get("branch", "main")
            store.save_state(p, st)
            return self._json(r)
        if path == "/api/git/set-remote":
            st, p = self._with_state(b)
            r = gitsync.set_remote(p, b.get("url", ""))
            st.setdefault("github", {})["remote"] = b.get("url", "")
            store.save_state(p, st)
            return self._json(r)
        if path == "/api/git/lfs":
            st, p = self._with_state(b)
            r = gitsync.track_lfs(p, b.get("patterns", []))
            st.setdefault("github", {})["lfs"] = r.get("ok", False)
            store.save_state(p, st)
            return self._json(r)
        if path == "/api/git/sync":
            st, p = self._with_state(b)
            r = gitsync.sync(p, b.get("message", ""), bool(b.get("push", True)),
                             b.get("branch", ""))
            gh = st.setdefault("github", {})
            gh["last_sync"] = store.now_iso() if hasattr(store, "now_iso") else ""
            store.save_state(p, st)
            return self._json(r)

        # ---- backups ----------------------------------------------------- #
        if path == "/api/backup/create":
            st, p = self._with_state(b)
            r = backup.create(p, st.get("version", ""), b.get("label", ""))
            store.save_state(p, st)
            return self._json(r)
        if path == "/api/backup/restore":
            _, p = self._with_state(b)
            return self._json(backup.restore(p, b.get("file", "")))
        if path == "/api/backup/delete":
            _, p = self._with_state(b)
            return self._json(backup.delete(p, b.get("file", "")))

        return self._json({"error": "unknown endpoint"}, 404)


def main():
    open_browser = "--no-browser" not in sys.argv
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    url = "http://%s:%d" % (HOST, PORT)
    print("PlanIDE %s -> %s" % (version(), url))
    print("  projects registry: %s" % store.registry_path())
    print("  Ctrl-C to stop.")
    if open_browser and os.environ.get("PLANIDE_OPEN", "1") == "1":
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
