"""Zip-snapshot backups of a tracked project.

Snapshots land in <project>/.planide/backups/ and are named
<project>-<version>-<timestamp>.zip. Heavy / regenerable directories
(node_modules, .git, venv, target, build, and the backups folder itself) are
skipped so a snapshot stays small and fast. Restore extracts into a sibling
folder so it never clobbers the live project by surprise.
"""

from __future__ import annotations

import os
import time
import zipfile

from .detect import SKIP_DIRS

BACKUP_SKIP = set(SKIP_DIRS) | {".git"}


def backups_dir(project_path: str) -> str:
    d = os.path.join(project_path, ".planide", "backups")
    os.makedirs(d, exist_ok=True)
    return d


def _iter_files(project_path: str):
    for root, dirs, files in os.walk(project_path):
        dirs[:] = [d for d in dirs if d not in BACKUP_SKIP]
        for f in files:
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, project_path)
            # never back up the backups themselves
            if rel.startswith(os.path.join(".planide", "backups")):
                continue
            yield fp, rel


def create(project_path: str, version: str = "", label: str = "") -> dict:
    project_path = os.path.abspath(os.path.expanduser(project_path))
    if not os.path.isdir(project_path):
        return {"ok": False, "error": "no such directory"}
    ts = time.strftime("%Y%m%d-%H%M%S")
    base = os.path.basename(project_path.rstrip("/")) or "project"
    tag = (version or "").strip().replace("/", "-")
    parts = [base]
    if tag:
        parts.append("v" + tag)
    if label.strip():
        parts.append(label.strip().replace(" ", "_")[:24])
    parts.append(ts)
    fname = "-".join(parts) + ".zip"
    out = os.path.join(backups_dir(project_path), fname)

    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp, rel in _iter_files(project_path):
            try:
                zf.write(fp, rel)
                count += 1
            except OSError:
                continue
    size = os.path.getsize(out)
    return {"ok": True, "file": fname, "path": out, "size": size,
            "size_mb": round(size / 1024 / 1024, 2), "files": count,
            "created_at": ts}


def listing(project_path: str) -> list:
    d = backups_dir(project_path)
    out = []
    for f in sorted(os.listdir(d), reverse=True):
        if not f.endswith(".zip"):
            continue
        fp = os.path.join(d, f)
        try:
            sz = os.path.getsize(fp)
            mt = os.path.getmtime(fp)
        except OSError:
            continue
        out.append({
            "file": f, "size": sz, "size_mb": round(sz / 1024 / 1024, 2),
            "created_at": time.strftime("%Y-%m-%d %H:%M", time.localtime(mt)),
        })
    return out


def restore(project_path: str, filename: str) -> dict:
    """Extract a snapshot into <project>/.planide/restored-<name>/."""
    project_path = os.path.abspath(os.path.expanduser(project_path))
    src = os.path.join(backups_dir(project_path), os.path.basename(filename))
    if not os.path.isfile(src):
        return {"ok": False, "error": "backup not found"}
    dest = os.path.join(project_path, ".planide",
                        "restored-" + os.path.splitext(os.path.basename(filename))[0])
    os.makedirs(dest, exist_ok=True)
    with zipfile.ZipFile(src, "r") as zf:
        zf.extractall(dest)
    return {"ok": True, "restored_to": dest}


def delete(project_path: str, filename: str) -> dict:
    src = os.path.join(backups_dir(project_path), os.path.basename(filename))
    if os.path.isfile(src):
        os.remove(src)
        return {"ok": True}
    return {"ok": False, "error": "not found"}
