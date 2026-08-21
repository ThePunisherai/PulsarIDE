#!/usr/bin/env python3
"""Durable Council memory sync for Graphify, Obsidian, and ThePunisher Data."""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

MANAGED_BEGIN = "<!-- THEPUNISHER:MANAGED:BEGIN -->"
MANAGED_END = "<!-- THEPUNISHER:MANAGED:END -->"


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slug(value):
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value).strip()).strip("-._").lower()
    return clean or "project"


def version_slug(value):
    """Direct response to "letop versies van dingen kunnen anders zijn of net
    benameming maak dat slimmer" (watch out, versions of things can differ or have
    slightly different naming, make that smarter): slug() alone treats "v258",
    "V258", and "258" as three different directory names, fragmenting the SAME
    version across Data/Projects/<slug>/<version>/ just because of how it happened
    to be typed that run. Strips a leading v/V version prefix (only when directly
    followed by a digit, so a real word like "very-beta" is never touched) before
    slugging, so those three collapse into the same "258" directory."""
    raw = str(value).strip()
    normalized = re.sub(r"^[vV](?=\d)", "", raw)
    return slug(normalized)


def data_root():
    explicit = os.environ.get("THEPUNISHER_DATA_DIR")
    if explicit:
        return Path(explicit).expanduser()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
        return base / "ThePunisher-Agent" / "Data"
    base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "thepunisher-agent" / "Data"


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, TypeError):
        return {} if default is None else default


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    os.replace(temp, path)


def append_jsonl(path, value, keep=1000):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        pass
    lines.append(json.dumps(value, ensure_ascii=True))
    path.write_text("\n".join(lines[-keep:]) + "\n", encoding="utf-8")


def detect_version(project):
    version_file = project / "VERSION"
    if version_file.is_file():
        value = version_file.read_text(encoding="utf-8-sig", errors="replace").strip()
        if value:
            return value
    package = read_json(project / "package.json", {})
    if package.get("version"):
        return str(package["version"])
    pyproject = project / "pyproject.toml"
    if pyproject.is_file():
        match = re.search(r"(?m)^version\s*=\s*[\"']([^\"']+)", pyproject.read_text(encoding="utf-8", errors="replace"))
        if match:
            return match.group(1)
    return os.environ.get("THEPUNISHER_PROJECT_VERSION", "unknown")


def detect_obsidian_vault():
    """Same auto-detection dashboard/server.py's detect_obsidian_vault() does (Obsidian's own
    obsidian.json, picking the most-recently-opened vault that still exists on disk) --
    duplicated here rather than imported so this script stays a standalone, dependency-free
    CLI callable from a hook with no dashboard process running. Direct fix for a real gap:
    this function did not exist here at all before, so a user who never explicitly saved a
    vault path via the dashboard's Configure panel (relying on auto-detection alone, which the
    dashboard's OWN /api/graph endpoint already honors) got real Obsidian notes silently never
    written, even though the dashboard's Knowledge Graph tab could resolve the same vault fine
    -- the two code paths disagreed on what "configured" meant."""
    if sys.platform == "darwin":
        cfg_path = Path.home() / "Library" / "Application Support" / "obsidian" / "obsidian.json"
    elif os.name == "nt":
        appdata = os.environ.get("APPDATA")
        cfg_path = Path(appdata) / "Obsidian" / "obsidian.json" if appdata else None
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        cfg_path = Path(xdg) / "obsidian" / "obsidian.json" if xdg else Path.home() / ".config" / "obsidian" / "obsidian.json"
    if not cfg_path or not cfg_path.is_file():
        return None
    data = read_json(cfg_path, None)
    if not isinstance(data, dict):
        return None
    vaults = sorted(data.get("vaults", {}).values(), key=lambda v: v.get("ts", 0), reverse=True)
    for v in vaults:
        p = v.get("path")
        if p and Path(p).is_dir():
            return Path(p)
    return None


def obsidian_vault():
    explicit = os.environ.get("OBSIDIAN_VAULT_PATH")
    if explicit and Path(explicit).is_dir():
        return Path(explicit)
    settings = read_json(Path.home() / ".config" / "thepunisher" / "dashboard-settings.json", {})
    configured = settings.get("obsidian_vault_path")
    if configured and Path(configured).expanduser().is_dir():
        return Path(configured).expanduser()
    return detect_obsidian_vault()


def update_obsidian(vault, metadata):
    note = vault / "ThePunisher" / (metadata["project_slug"] + ".md")
    note.parent.mkdir(parents=True, exist_ok=True)
    existing = note.read_text(encoding="utf-8", errors="replace") if note.exists() else ""
    managed = "\n".join([
        MANAGED_BEGIN,
        "# " + metadata["project_name"],
        "",
        "- Version: " + metadata["version"],
        "- Last Council sync: " + metadata["updated_at"],
        "- Project path: `" + metadata["project_path"] + "`",
        "- Last agent: " + (metadata.get("agent") or "Council"),
        "- Last event: " + (metadata.get("event") or "sync"),
        "",
        "[[ThePunisher Council]]",
        MANAGED_END,
    ])
    if MANAGED_BEGIN in existing and MANAGED_END in existing:
        before = existing.split(MANAGED_BEGIN, 1)[0]
        after = existing.split(MANAGED_END, 1)[1]
        text = before + managed + after
    else:
        text = (existing.rstrip() + "\n\n" if existing.strip() else "") + managed + "\n"
    note.write_text(text, encoding="utf-8")
    return note


# Any of these means graphify can run semantic extraction on docs/papers/data files
# (research/RE findings, emulator/protocol notes, etc.), not just code via local AST.
# Verified live: `graphify extract .` with none of these set fails cleanly with
# "error: no LLM API key found ... pass --code-only to index just the code" (exit 1) --
# so this MUST be checked before dropping --code-only, never assumed available.
_LLM_KEY_ENV_VARS = (
    "GEMINI_API_KEY", "GOOGLE_API_KEY", "MOONSHOT_API_KEY",
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY",
)


def _graphify_exe():
    """Find the graphify CLI. PulsarIDE provisions it into its own isolated venv
    (~/.config/pulsaride/pyenv), so that comes first -- it works even when the
    venv's bin dir is not on PATH (the common case for an app-managed venv). Falls
    back to an explicit override, then a normal PATH lookup for a user who
    installed graphify themselves."""
    override = os.environ.get("PULSAR_GRAPHIFY")
    if override and Path(override).is_file():
        return override
    if os.name == "nt":
        venv = Path.home() / ".config" / "pulsaride" / "pyenv" / "Scripts" / "graphify.exe"
    else:
        venv = Path.home() / ".config" / "pulsaride" / "pyenv" / "bin" / "graphify"
    if venv.is_file() and os.access(str(venv), os.X_OK):
        return str(venv)
    return shutil.which("graphify")


def graphify_sync(project, project_slug, force=False):
    executable = _graphify_exe()
    receipt = {"available": bool(executable), "updated_at": utc_now(), "status": "not-installed"}
    if not executable:
        return receipt
    output = project / "graphify-out" / "graph.json"
    if output.exists() and not force and time.time() - output.stat().st_mtime < 21600:
        receipt.update({"status": "fresh", "graph_path": str(output)})
        return receipt
    # Direct response to "data voorbeelden van emulator en graphify in map gezet ...
    # moet in onze eigen agent mapje komen zodat graphify brain per vraag ook daar terug
    # kan ophalen" (I put example data for emulator/graphify in a folder, that kind of
    # data needs to reach graphify's brain so it can be recalled per question) --
    # --code-only unconditionally was the actual reason research/RE findings, protocol
    # notes, and any other non-code example data a user drops into a project were never
    # indexed at all, regardless of where they put them.
    has_llm_key = any(os.environ.get(name) for name in _LLM_KEY_ENV_VARS)
    extract_args = [executable, "extract", "."] if has_llm_key else [executable, "extract", ".", "--code-only"]
    try:
        extract = subprocess.run(
            extract_args, cwd=str(project),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=25, check=False,
        )
        if extract.returncode != 0 and has_llm_key:
            # A configured key can still fail at runtime (rate limit, network, revoked
            # key) -- fall back to the always-safe code-only pass rather than losing the
            # whole sync over a docs/papers/data extraction failure.
            extract = subprocess.run(
                [executable, "extract", ".", "--code-only"], cwd=str(project),
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, timeout=25, check=False,
            )
            has_llm_key = False
        if extract.returncode != 0:
            receipt.update({"status": "failed", "error": (extract.stderr or extract.stdout)[-500:]})
            return receipt
        receipt["scope"] = "code+docs" if has_llm_key else "code-only"
        register = subprocess.run(
            [executable, "global", "add", str(output), "--as", project_slug],
            cwd=str(project), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, timeout=10, check=False,
        )
        receipt.update({
            "status": "synced" if register.returncode == 0 else "extracted",
            "graph_path": str(output),
            "register_error": "" if register.returncode == 0 else (register.stderr or register.stdout)[-500:],
        })
    except subprocess.TimeoutExpired:
        receipt.update({"status": "timeout", "error": "Graphify exceeded the bounded runtime."})
    except OSError as exc:
        receipt.update({"status": "failed", "error": str(exc)})
    return receipt


def sync(args):
    project = Path(args.project or os.getcwd()).expanduser().resolve()
    if not project.is_dir():
        raise ValueError("Project directory does not exist: " + str(project))
    root = data_root()
    project_name = args.name or project.name
    project_slug = slug(project_name)
    version = args.version or detect_version(project)
    now = utc_now()
    metadata = {
        "schema_version": 1,
        "project_name": project_name,
        "project_slug": project_slug,
        "project_path": str(project),
        "version": version,
        "version_slug": version_slug(version),
        "game_version": args.game_version or os.environ.get("THEPUNISHER_GAME_VERSION", ""),
        "application_name": args.application or os.environ.get("THEPUNISHER_APPLICATION_NAME", project_name),
        "agent": args.agent or "Council",
        "team": args.team or "The Council",
        "event": args.event or "sync",
        "updated_at": now,
    }

    project_dir = root / "Projects" / project_slug / version_slug(version)
    project_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(project_dir / "metadata.json", metadata)
    append_jsonl(project_dir / "activity.jsonl", metadata)

    graph = {"status": "skipped", "updated_at": now}
    if not args.no_tools:
        graph = graphify_sync(project, project_slug, args.force)
    atomic_json(root / "Graphify" / (project_slug + ".json"), dict(metadata, graphify=graph))

    vault = None if args.no_tools else obsidian_vault()
    obsidian = {"available": bool(vault), "status": "not-configured", "updated_at": now}
    if vault:
        try:
            note = update_obsidian(vault, metadata)
            obsidian.update({"status": "synced", "vault_path": str(vault), "note_path": str(note)})
        except OSError as exc:
            obsidian.update({"status": "failed", "error": str(exc)})
    atomic_json(root / "Obsidian" / (project_slug + ".json"), dict(metadata, obsidian=obsidian))

    receipt = dict(metadata, data_dir=str(root), graphify=graph, obsidian=obsidian)
    append_jsonl(root / "Activity" / "council-memory.jsonl", receipt)
    print(json.dumps(receipt, ensure_ascii=True))
    return 0


def overview(_args):
    """The centralized cross-project view: direct response to "wil dat dit altijd in
    folder van agent gemaakt van onze the punisher ai waar die staan zodat die altijd
    alle data heeft" (I want this to always be in the folder our ThePunisher AI made,
    wherever that is, so it always has all the data) -- reads the SAME durable Data
    directory every project's sync() call already writes into (not the project's own
    folder), grouping every known version of every project (using version_slug for the
    grouping key, so "v258"/"V258"/"258" are recognized as the same version instead of
    fragmenting) with its latest Graphify/Obsidian sync status. Read-only, no subprocess
    calls -- safe to run as often as needed (the dashboard polls this)."""
    root = data_root()
    projects_dir = root / "Projects"
    projects = []
    if projects_dir.is_dir():
        for project_dir in sorted(p for p in projects_dir.iterdir() if p.is_dir()):
            versions = []
            for version_dir in sorted(v for v in project_dir.iterdir() if v.is_dir()):
                meta = read_json(version_dir / "metadata.json", {})
                if meta:
                    versions.append(meta)
            if not versions:
                continue
            versions.sort(key=lambda m: m.get("updated_at", ""), reverse=True)
            latest = versions[0]
            graphify_receipt = read_json(root / "Graphify" / (project_dir.name + ".json"), {})
            obsidian_receipt = read_json(root / "Obsidian" / (project_dir.name + ".json"), {})
            projects.append({
                "project_slug": project_dir.name,
                "project_name": latest.get("project_name", project_dir.name),
                "application_name": latest.get("application_name", ""),
                "latest_version": latest.get("version", ""),
                "latest_game_version": latest.get("game_version", ""),
                "latest_updated_at": latest.get("updated_at", ""),
                # "Recognized by our agent" -- every entry here only exists because a real
                # ThePunisher agent/team called sync() (via the SessionStart hook or a
                # Live Activity event), never a bare graphify/Obsidian run on its own. The
                # metadata already carries WHICH agent/team and via what trigger; overview()
                # previously dropped those fields on the floor even though sync() writes
                # them, so the dashboard's Data Overview panel couldn't show this even
                # though the recognition already happened at write time.
                "latest_agent": latest.get("agent", ""),
                "latest_team": latest.get("team", ""),
                "latest_event": latest.get("event", ""),
                "auto_detected": any(m.get("event") == "session-start" for m in versions),
                "known_versions": [
                    {"version": m.get("version", ""), "version_slug": m.get("version_slug", ""),
                     "updated_at": m.get("updated_at", "")}
                    for m in versions
                ],
                "graphify": graphify_receipt.get("graphify", {"status": "unknown"}),
                "obsidian": obsidian_receipt.get("obsidian", {"status": "unknown"}),
            })
    projects.sort(key=lambda p: p["latest_updated_at"], reverse=True)
    print(json.dumps({"data_dir": str(root), "projects": projects}, ensure_ascii=True))
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", default="sync", choices=["sync", "overview"],
                         help="sync (default, backward-compatible with every existing caller) or overview (read-only cross-project summary)")
    parser.add_argument("--project", default="")
    parser.add_argument("--name", default="")
    parser.add_argument("--version", default="")
    parser.add_argument("--game-version", default="")
    parser.add_argument("--application", default="")
    parser.add_argument("--agent", default="")
    parser.add_argument("--team", default="")
    parser.add_argument("--event", default="session-start")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-tools", action="store_true", help="Write deterministic Data receipts without invoking Graphify/Obsidian.")
    args = parser.parse_args()
    return overview(args) if args.command == "overview" else sync(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print("council-memory: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
