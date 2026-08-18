"""Git / GitHub integration for a tracked project.

Everything shells out to the real `git` binary -- no libraries, no stored
credentials. PlanIDE runs locally, so pushes use whatever git auth the user
already has (credential helper, SSH key, gh). All subprocess calls run headless:
    * GIT_TERMINAL_PROMPT=0      -- never block on an interactive auth prompt
    * stdin = DEVNULL            -- never inherit a TTY that can hang a read
    * a hard timeout on every call

Capabilities exposed to the server / CLI:
    status(path)            -- branch, dirty?, ahead/behind, remote, has_git
    init(path, branch)      -- git init + first-time setup
    set_remote(path, url)   -- add/replace origin
    large_files(path, mb)   -- find files above a threshold (LFS candidates)
    track_lfs(path, exts)   -- git lfs track + write .gitattributes
    sync(path, message, push) -- add -A, commit, optional push (with retry)
"""

from __future__ import annotations

import os
import subprocess
import time

TIMEOUT = 120
# files/dirs we never want committed by accident -> seeded into .gitignore
DEFAULT_IGNORES = [
    ".planide/backups/", "node_modules/", "__pycache__/", "*.pyc",
    ".venv/", "venv/", "dist/", "build/", "target/", ".DS_Store",
]


def _git(path: str, *args, timeout: int = TIMEOUT) -> tuple[int, str, str]:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env.setdefault("GIT_ASKPASS", "echo")
    try:
        proc = subprocess.run(
            ["git", "-C", path, *args],
            stdin=subprocess.DEVNULL,
            capture_output=True, text=True, env=env, timeout=timeout,
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except FileNotFoundError:
        return 127, "", "git is not installed / not on PATH"
    except subprocess.TimeoutExpired:
        return 124, "", "git command timed out after %ds" % timeout


def has_git(path: str) -> bool:
    code, out, _ = _git(path, "rev-parse", "--is-inside-work-tree")
    return code == 0 and out == "true"


def status(path: str) -> dict:
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(path):
        return {"ok": False, "error": "no such directory"}
    if not has_git(path):
        return {"ok": True, "has_git": False, "path": path}

    _, branch, _ = _git(path, "rev-parse", "--abbrev-ref", "HEAD")
    code, porcelain, _ = _git(path, "status", "--porcelain")
    dirty = bool(porcelain.strip())
    changed = [l for l in porcelain.splitlines() if l.strip()]

    _, remote, _ = _git(path, "remote", "get-url", "origin")
    ahead = behind = 0
    upstream_ok = False
    code, counts, _ = _git(path, "rev-list", "--left-right", "--count",
                           "@{upstream}...HEAD")
    if code == 0 and counts:
        parts = counts.split()
        if len(parts) == 2:
            behind, ahead = int(parts[0]), int(parts[1])
            upstream_ok = True

    _, last, _ = _git(path, "log", "-1", "--pretty=%h  %s  (%cr)")
    return {
        "ok": True, "has_git": True, "path": path,
        "branch": branch, "dirty": dirty, "changed": changed[:100],
        "changed_count": len(changed),
        "remote": remote, "has_remote": bool(remote),
        "ahead": ahead, "behind": behind, "upstream": upstream_ok,
        "last_commit": last,
    }


def _write_gitignore(path: str) -> None:
    gi = os.path.join(path, ".gitignore")
    existing = ""
    if os.path.isfile(gi):
        with open(gi, "r", encoding="utf-8", errors="ignore") as fh:
            existing = fh.read()
    add = [line for line in DEFAULT_IGNORES if line not in existing]
    if add:
        with open(gi, "a", encoding="utf-8") as fh:
            if existing and not existing.endswith("\n"):
                fh.write("\n")
            fh.write("\n# added by PlanIDE\n" + "\n".join(add) + "\n")


def init(path: str, branch: str = "main") -> dict:
    path = os.path.abspath(os.path.expanduser(path))
    if has_git(path):
        return {"ok": True, "message": "already a git repo", "has_git": True}
    code, out, err = _git(path, "init", "-b", branch)
    if code != 0:
        # older git without -b
        code, out, err = _git(path, "init")
        if code == 0:
            _git(path, "checkout", "-b", branch)
    if code != 0:
        return {"ok": False, "error": err or out}
    _write_gitignore(path)
    return {"ok": True, "message": "initialised git repo on '%s'" % branch,
            "has_git": True}


def set_remote(path: str, url: str) -> dict:
    path = os.path.abspath(os.path.expanduser(path))
    if not has_git(path):
        init(path)
    # replace if it exists
    code, _, _ = _git(path, "remote", "get-url", "origin")
    if code == 0:
        _git(path, "remote", "set-url", "origin", url)
    else:
        _git(path, "remote", "add", "origin", url)
    return {"ok": True, "remote": url}


def large_files(path: str, threshold_mb: float = 50.0) -> dict:
    """List tracked/untracked files above threshold_mb (LFS candidates)."""
    from .detect import SKIP_DIRS
    path = os.path.abspath(os.path.expanduser(path))
    thresh = int(threshold_mb * 1024 * 1024)
    big = []
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and d != ".git"]
        for f in files:
            fp = os.path.join(root, f)
            try:
                sz = os.path.getsize(fp)
            except OSError:
                continue
            if sz >= thresh:
                big.append({
                    "path": os.path.relpath(fp, path),
                    "size": sz,
                    "size_mb": round(sz / 1024 / 1024, 1),
                    "ext": os.path.splitext(f)[1].lower() or "(none)",
                })
    big.sort(key=lambda x: x["size"], reverse=True)
    exts = sorted({b["ext"] for b in big if b["ext"] != "(none)"})
    return {"ok": True, "threshold_mb": threshold_mb, "count": len(big),
            "files": big[:200], "extensions": exts}


def track_lfs(path: str, patterns: list) -> dict:
    """Run `git lfs track <pattern>` for each pattern (writes .gitattributes)."""
    path = os.path.abspath(os.path.expanduser(path))
    # is git-lfs available?
    code, _, _ = _git(path, "lfs", "version")
    if code != 0:
        return {"ok": False, "error": "git-lfs is not installed. Install it: "
                "https://git-lfs.com then re-run.", "installed": False}
    if not has_git(path):
        init(path)
    _git(path, "lfs", "install", "--local")
    tracked = []
    for p in patterns:
        p = p.strip()
        if not p:
            continue
        # accept ".zip" or "*.zip" or a path
        if p.startswith(".") and "/" not in p and "*" not in p:
            p = "*" + p
        code, out, err = _git(path, "lfs", "track", p)
        if code == 0:
            tracked.append(p)
    return {"ok": True, "installed": True, "tracked": tracked}


def sync(path: str, message: str = "", push: bool = True,
         branch: str = "", retries: int = 4) -> dict:
    """Stage everything, commit, and (optionally) push with exponential backoff."""
    path = os.path.abspath(os.path.expanduser(path))
    log = []
    if not has_git(path):
        r = init(path, branch or "main")
        log.append(r.get("message", "init"))

    if not branch:
        _, branch, _ = _git(path, "rev-parse", "--abbrev-ref", "HEAD")
        branch = branch or "main"

    # stage
    _git(path, "add", "-A")
    code, porc, _ = _git(path, "status", "--porcelain")
    committed = False
    if porc.strip():
        msg = message.strip() or "PlanIDE: sync tracker + project state"
        code, out, err = _git(path, "commit", "-m", msg)
        if code == 0:
            committed = True
            log.append("committed: %s" % msg)
        else:
            log.append("commit failed: %s" % (err or out))
    else:
        log.append("nothing to commit (working tree clean)")

    pushed = False
    push_error = ""
    if push:
        code, _, _ = _git(path, "remote", "get-url", "origin")
        if code != 0:
            push_error = "no 'origin' remote set -- add one first"
            log.append(push_error)
        else:
            delay = 2
            for attempt in range(1, retries + 1):
                code, out, err = _git(path, "push", "-u", "origin", branch,
                                      timeout=180)
                if code == 0:
                    pushed = True
                    log.append("pushed to origin/%s" % branch)
                    break
                push_error = err or out
                # auth / non-network failures should not be retried blindly
                low = push_error.lower()
                if any(k in low for k in ("authentication", "permission",
                                          "denied", "could not read",
                                          "rejected", "not found")):
                    log.append("push failed (not retrying): %s" % push_error)
                    break
                log.append("push attempt %d failed: %s" % (attempt, push_error))
                if attempt < retries:
                    time.sleep(delay)
                    delay *= 2
    return {
        "ok": committed or (push and pushed) or not push,
        "committed": committed, "pushed": pushed,
        "branch": branch, "log": log, "push_error": push_error,
    }
