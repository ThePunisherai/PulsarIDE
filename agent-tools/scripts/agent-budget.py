#!/usr/bin/env python3
"""What fills Claude Code's agent-description cap on this machine, and the fix.

Claude Code prints "Agent descriptions are over the 15.0k-token limit (~N tokens)"
on every launch when the descriptions of all the agents it can load add up past
15,000 tokens. It counts them its own way -- read off the CLI (2.1.281), not the
docs: for every active agent that is not built in (enabled plugins, then
~/.claude/agents, then the project's .claude/agents, deduped by name, the later
one winning) it takes round(len(f"{name}: {description}") / 4) and sums.

This prints that number and where it comes from. The usual cause is several
copies of the same 100-lead Pulse Agent roster -- an older `pulsar-*` naming, a
retired lead, ThePunisher-Agent's standalone `thepunisher-*` install -- and
--prune removes those, in every agent root (Claude Code, Gemini CLI, Qwen Code,
Codex, Antigravity), exactly as PulsarIDE now does on every launch. An agent you
wrote yourself, or one a plugin ships, is reported and never touched.

    python3 agent-budget.py                      # the report
    python3 agent-budget.py --project ~/code/app # include that project's agents
    python3 agent-budget.py --prune --dry-run    # what --prune would remove
    python3 agent-budget.py --prune              # remove stale roster copies
    python3 agent-budget.py --json               # machine-readable

Exit status: 0 under the cap, 1 over it, 2 on a usage or I/O error.
Standard library only; works the same on Windows, macOS and Linux.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

LOG = logging.getLogger("agent-budget")

CLAUDE_AGENT_CAP = 15000
CHARS_PER_TOKEN = 4
# Every prefix a generated copy of the team-lead roster has ever been deployed under.
ROSTER_PREFIX = re.compile(r"^(pulse|pulsar|thepunisher)-")
# The prefix the current PulsarIDE roster is deployed under.
CURRENT_PREFIX = "pulse-"
MAX_DEPTH = 6


class BudgetError(Exception):
    """A problem the user has to fix before anything can be measured or removed."""


@dataclass
class Agent:
    name: str
    source: str
    tokens: int
    path: str


@dataclass
class Report:
    limit: int
    total: int
    over: bool
    sources: list[dict]
    largest: list[dict]
    stale: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    keep_set_from: str = ""
    project: str | None = None


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        LOG.debug("unreadable %s: %s", path, exc)
        return None


def read_json(path: Path) -> dict:
    text = read_text(path)
    if text is None:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        LOG.warning("not valid JSON, ignored: %s (%s)", path, exc)
        return {}
    return data if isinstance(data, dict) else {}


def is_generated_roster(body: str) -> bool:
    """A generated copy of the roster -- never an agent someone wrote by hand.

    Content decides, not the name: every lead PulsarIDE deploys carries its
    tracker section, every roster lead carries an Activation signal section, and
    ThePunisher-Agent's copies name themselves.
    """
    return (
        "## PulsarIDE built-in tracker" in body
        or re.search(r"^## Activation signal", body, re.M) is not None
        or "ThePunisher —" in body
        or re.search(r"^name:\s*thepunisher-", body, re.M) is not None
        or re.search(r'^name\s*=\s*"thepunisher-', body, re.M) is not None
    )


def frontmatter(md: str) -> tuple[str, str] | None:
    """`name` and `description` as Claude Code reads them, or None if either is missing.

    A folded (>) block joins its lines with spaces, a literal (|) block keeps its
    newlines, a plain or quoted scalar may continue on indented lines.
    """
    m = re.match(r"^---\r?\n(.*?)\r?\n---", md, re.S)
    if not m:
        return None
    lines = re.split(r"\r?\n", m.group(1))

    def scalar(key: str) -> str:
        idx = next((i for i, line in enumerate(lines) if line.startswith(f"{key}:")), -1)
        if idx < 0:
            return ""
        head = lines[idx][len(key) + 1:].strip()
        rest: list[str] = []
        for line in lines[idx + 1:]:
            if line.strip() and not line[:1].isspace():
                break
            rest.append(line.strip())
        if re.fullmatch(r"[>|][+-]?", head):
            if head.startswith(">"):
                return " ".join(r for r in rest if r)
            return "\n".join(rest).strip()
        joined = " ".join([head] + [r for r in rest if r]).strip()
        quoted = re.fullmatch(r"(['\"])(.*)\1", joined, re.S)
        return (quoted.group(2) if quoted else joined).strip()

    name, description = scalar("name"), scalar("description")
    return (name, description) if name and description else None


def markdown_under(directory: Path, depth: int = 0) -> list[Path]:
    if depth > MAX_DEPTH or not directory.is_dir():
        return []
    out: list[Path] = []
    try:
        entries = sorted(directory.iterdir())
    except OSError as exc:
        LOG.debug("cannot list %s: %s", directory, exc)
        return []
    for entry in entries:
        if entry.is_dir():
            out.extend(markdown_under(entry, depth + 1))
        elif entry.suffix == ".md":
            out.append(entry)
    return out


def plugin_agent_dirs(home: Path) -> list[tuple[str, Path]]:
    """Agents folders of the Claude Code plugins that are installed AND enabled."""
    enabled = read_json(home / ".claude" / "settings.json").get("enabledPlugins") or {}
    installed = read_json(home / ".claude" / "plugins" / "installed_plugins.json").get("plugins") or {}
    out: list[tuple[str, Path]] = []
    for plugin_id, entry in installed.items():
        if enabled.get(plugin_id) is not True:
            continue
        # installed_plugins.json v2 keeps a list of installs per plugin, v1 one object.
        for inst in entry if isinstance(entry, list) else [entry]:
            path = inst.get("installPath") if isinstance(inst, dict) else None
            if isinstance(path, str):
                out.append((plugin_id, Path(path) / "agents"))
    return out


def norm(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def keep_set(home: Path, bundle: Path | None) -> tuple[set[str] | None, str]:
    """The roster entries that are current. None means: keep `pulse-*`, drop the older prefixes."""
    if bundle is not None:
        agents_dir = bundle / "agents"
        leads = [
            f.name for f in agents_dir.glob("*.md")
            if re.search(r"^name:\s*\S", (read_text(f) or "")[:600], re.M)
        ]
        if not leads:
            raise BudgetError(f"no team leads under {agents_dir} -- refusing to prune against an empty bundle")
        keep: set[str] = set()
        for lead in leads:
            stem = lead[:-3]
            for root in (home / ".claude" / "agents", home / ".gemini" / "agents", home / ".qwen" / "agents"):
                keep.add(norm(root / f"{CURRENT_PREFIX}{lead}"))
            keep.add(norm(home / ".codex" / "agents" / f"{CURRENT_PREFIX}{stem}.toml"))
            keep.add(norm(home / ".gemini" / "config" / "agents" / f"{CURRENT_PREFIX}{stem}"))
        return keep, f"bundle {bundle}"
    marker = home / ".config" / "pulsaride" / "agent-bundle.json"
    written = read_json(marker).get("agents")
    if isinstance(written, list) and written:
        return {norm(p) for p in written if isinstance(p, str)}, f"PulsarIDE marker {marker}"
    return None, f"no marker -- keeping {CURRENT_PREFIX}*, removing older prefixes"


def roster_entries(home: Path) -> list[tuple[Path, Path]]:
    """(entry to remove, file whose content decides) for every roster-prefixed entry."""
    found: list[tuple[Path, Path]] = []
    for root in (home / ".claude" / "agents", home / ".gemini" / "agents", home / ".qwen" / "agents"):
        if root.is_dir():
            found += [(p, p) for p in root.iterdir() if p.suffix == ".md" and ROSTER_PREFIX.match(p.name)]
    codex = home / ".codex" / "agents"
    if codex.is_dir():
        found += [(p, p) for p in codex.iterdir() if p.suffix == ".toml" and ROSTER_PREFIX.match(p.name)]
    antigravity = home / ".gemini" / "config" / "agents"
    if antigravity.is_dir():
        found += [
            (p, p / "agent.md") for p in antigravity.iterdir()
            if p.is_dir() and ROSTER_PREFIX.match(p.name) and (p / "agent.md").is_file()
        ]
    return found


def stale_roster(home: Path, keep: set[str] | None) -> list[Path]:
    stale: list[Path] = []
    for entry, content in roster_entries(home):
        body = read_text(content)
        if body is None or not is_generated_roster(body):
            continue
        current = norm(entry) in keep if keep is not None else entry.name.startswith(CURRENT_PREFIX)
        if not current:
            stale.append(entry)
    return stale


def remove(paths: list[Path], dry_run: bool) -> list[str]:
    removed: list[str] = []
    for path in paths:
        if dry_run:
            LOG.info("would remove %s", path)
            removed.append(str(path))
            continue
        try:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            LOG.info("removed %s", path)
            removed.append(str(path))
        except OSError as exc:
            LOG.error("could not remove %s: %s", path, exc)
    return removed


def measure(home: Path, project: Path | None, stale: set[str]) -> tuple[list[Agent], list[dict]]:
    by_name: dict[str, Agent] = {}

    def add(directory: Path, source_of, prefix: str = "") -> None:
        for file in markdown_under(directory):
            body = read_text(file)
            fm = frontmatter(body) if body is not None else None
            if not fm:
                LOG.debug("not loaded by Claude Code (no name or description): %s", file)
                continue
            name = prefix + fm[0]
            tokens = round(len(f"{name}: {fm[1]}") / CHARS_PER_TOKEN)
            by_name[name] = Agent(name, source_of(file, body), tokens, str(file))

    for plugin_id, directory in plugin_agent_dirs(home):
        add(directory, lambda f, b, pid=plugin_id: f"plugin:{pid}", f"{plugin_id.split('@')[0]}:")
    user_dir = home / ".claude" / "agents"

    def user_source(file: Path, body: str) -> str:
        if norm(file) in stale:
            return "stale roster copy"
        if file.parent == user_dir and file.name.startswith(CURRENT_PREFIX) and is_generated_roster(body):
            return "pulse (PulsarIDE roster)"
        return "user"

    add(user_dir, user_source)
    if project is not None:
        add(project / ".claude" / "agents", lambda f, b: "project")

    agents = sorted(by_name.values(), key=lambda a: a.tokens, reverse=True)
    groups: dict[str, dict] = {}
    for a in agents:
        g = groups.setdefault(a.source, {"source": a.source, "agents": 0, "tokens": 0})
        g["agents"] += 1
        g["tokens"] += a.tokens
    return agents, sorted(groups.values(), key=lambda g: g["tokens"], reverse=True)


def build_report(home: Path, project: Path | None, bundle: Path | None, prune: bool,
                 dry_run: bool, top: int) -> Report:
    keep, keep_from = keep_set(home, bundle)
    LOG.debug("keep-set from %s", keep_from)
    stale = stale_roster(home, keep)
    removed: list[str] = []
    if prune and stale:
        removed = remove(stale, dry_run)
        if not dry_run:
            stale = stale_roster(home, keep)
    agents, sources = measure(home, project, {norm(p) for p in stale})
    total = sum(a.tokens for a in agents)
    return Report(
        limit=CLAUDE_AGENT_CAP,
        total=total,
        over=total > CLAUDE_AGENT_CAP,
        sources=sources,
        largest=[asdict(a) for a in agents[:top]],
        stale=[str(p) for p in stale],
        removed=removed,
        keep_set_from=keep_from,
        project=str(project) if project else None,
    )


def print_report(r: Report, prune: bool, dry_run: bool) -> None:
    verdict = f"OVER by {r.total - r.limit:,}" if r.over else f"under, {r.limit - r.total:,} to spare"
    print(f"Claude Code agent descriptions: ~{r.total:,} / {r.limit:,} tokens  ({verdict})\n")
    print(f"  {'source':34} {'agents':>6}  {'tokens':>8}")
    for s in r.sources:
        print(f"  {s['source'][:34]:34} {s['agents']:>6}  ~{s['tokens']:>7,}")
    if r.largest:
        print("\nLargest descriptions:")
        for a in r.largest:
            print(f"  ~{a['tokens']:>5,}  {a['name']}  [{a['source']}]")
    if r.removed:
        verb = "Would remove" if dry_run else "Removed"
        print(f"\n{verb} {len(r.removed)} stale roster copies (all agent roots).")
    stale_claude = [p for p in r.stale if f"{os.sep}.claude{os.sep}" in p]
    if r.stale and not (prune and not dry_run):
        print(f"\n{len(r.stale)} stale roster copies across all agent roots "
              f"({len(stale_claude)} in Claude Code). Remove them with --prune.")
    print(f"\nCurrent roster decided by: {r.keep_set_from}")
    if r.over and not r.stale:
        print("\nWhat is left is not a roster copy -- your own agents or a plugin's. Remove or")
        print("shorten the largest above, or disable the plugin; nothing here deletes them for you.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Measure Claude Code's agent-description budget and remove stale Pulse Agent roster copies.")
    ap.add_argument("--home", type=Path, default=Path.home(), help="home directory to inspect (default: yours)")
    ap.add_argument("--project", type=Path, help="also count this project's .claude/agents")
    ap.add_argument("--bundle", type=Path,
                    help="a PulsarIDE agent bundle (…/resources/pulsar-agents) to decide which leads are current")
    ap.add_argument("--prune", action="store_true", help="remove stale roster copies from every agent root")
    ap.add_argument("--dry-run", action="store_true", help="with --prune: list, remove nothing")
    ap.add_argument("--top", type=int, default=10, help="how many of the largest descriptions to list (default 10)")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    ap.add_argument("-v", "--verbose", action="store_true", help="log each file removed")
    ap.add_argument("--debug", action="store_true", help="log every file read and skipped")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    if args.dry_run and not args.prune:
        ap.error("--dry-run only applies with --prune")
    if args.top < 0:
        ap.error("--top must be 0 or more")
    home = args.home.expanduser()
    if not home.is_dir():
        print(f"error: home directory not found: {home}", file=sys.stderr)
        return 2
    project = args.project.expanduser() if args.project else None
    if project is not None and not project.is_dir():
        print(f"error: project directory not found: {project}", file=sys.stderr)
        return 2
    bundle = args.bundle.expanduser() if args.bundle else None

    try:
        report = build_report(home, project, bundle, args.prune, args.dry_run, args.top)
    except (BudgetError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(asdict(report), indent=2))
    else:
        print_report(report, args.prune, args.dry_run)
    return 1 if report.over else 0


if __name__ == "__main__":
    sys.exit(main())
