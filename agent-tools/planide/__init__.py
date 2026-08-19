"""PlanIDE -- local project command deck.

A zero-dependency (Python standard library only) project tracker that lives
next to your code. Pick any project folder (web app, .exe, emulator, library,
anything), track what works and what is broken, log AI-assisted fixes, keep a
roadmap and version history, snapshot backups, auto-detect the language/stack,
and sync to GitHub -- large files included.

Design intent: it feels like part of the ThePunisher / Agentic OS family
(same navy/red palette, same "run one Python file, no build step" philosophy)
but PlanIDE is a standalone tool that works on its own.

State model
-----------
* Central registry  : ~/.config/planide/projects.json  (the list of projects
                      you have added, by absolute path).
* Per-project state : <project>/.planide/state.json     (items, fixes, roadmap,
                      versions, github + backup metadata). It lives *inside* the
                      project so it travels with the code and can be committed.

Everything here is stdlib only: json, os, uuid, datetime, subprocess, zipfile.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

__version__ = "0.1.0"
NAME = "PlanIDE"

STATE_DIRNAME = ".planide"
STATE_FILE = "state.json"
REGISTRY_FILE = "projects.json"
SETTINGS_FILE = "settings.json"


def version() -> str:
    """Read the repo VERSION file if present, else the package constant."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    vf = os.path.join(here, "VERSION")
    try:
        with open(vf, "r", encoding="utf-8") as fh:
            v = fh.read().strip()
            if v:
                return v
    except OSError:
        pass
    return __version__


def config_dir() -> str:
    """Central config directory, honouring XDG_CONFIG_HOME."""
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(
        os.path.expanduser("~"), ".config"
    )
    d = os.path.join(base, "planide")
    os.makedirs(d, exist_ok=True)
    return d


def registry_path() -> str:
    return os.path.join(config_dir(), REGISTRY_FILE)


def settings_path() -> str:
    return os.path.join(config_dir(), SETTINGS_FILE)


def state_dir(project_path: str) -> str:
    d = os.path.join(project_path, STATE_DIRNAME)
    os.makedirs(d, exist_ok=True)
    return d


def state_path(project_path: str) -> str:
    return os.path.join(project_path, STATE_DIRNAME, STATE_FILE)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix: str = "") -> str:
    return (prefix + uuid.uuid4().hex[:12]) if prefix else uuid.uuid4().hex[:12]


def read_json(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path: str, obj) -> None:
    """Atomic-ish write: write to a temp file then rename."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)
