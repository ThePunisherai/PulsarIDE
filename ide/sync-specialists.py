#!/usr/bin/env python3
"""Generate the specialist roster the team leads are told to read.

The team-lead files ship with an instruction that a named specialist is NOT
separately spawnable (deploying all 5,050 as native subagents blows Claude
Code's ~15k-token description budget) and must instead be read off disk and
adopted inline. That instruction pointed at ThePunisher-Agent's own paths --
`agents/subagents/<team>/<file>.md` -- which PulsarIDE never shipped, so on a
PulsarIDE-only machine there was nothing to read and the whole specialist layer
was documentation for a thing that was not there.

This closes that, from the same source of truth ThePunisher-Agent generates
from: `agents/roster.json`.

One file per TEAM, not per specialist. Each upstream specialist file is ~7KB of
which ~6KB is the identical shared rules block repeated 5,050 times -- 41MB of
95% duplication. The unique content is a name, a team and a one-line role. A
per-team roster carries all of it in ~1MB total, and reads better: a lead opens
one file and sees every specialist it can adopt, instead of guessing filenames.

Usage:  python3 ide/sync-specialists.py [path-to-ThePunisher-Agent]
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "agent-bundle", "specialists")
DEFAULT_SRC = os.path.join(HERE, "..", "..", "ThePunisher-Agent")


def rebrand(text: str) -> str:
    """ThePunisher-XxxExpert -> Pulse-XxxExpert, and the bare product name.

    Only the agent-name prefix and the standalone product name: a role that
    happens to describe something else is left exactly as written.
    """
    text = re.sub(r"\bThePunisher-(?=[A-Za-z])", "Pulse-", text)
    text = re.sub(r"\bThePunisher\b", "Pulse Agent", text)
    return text


def write_team(slug: str, name: str, purpose: str, agents: list, growth: list) -> int:
    lines = [
        "---",
        f"team: {slug}",
        f"name: {rebrand(name)}",
        "---",
        "",
        f"# {rebrand(name)} — specialists",
        "",
        rebrand(purpose).strip(),
        "",
        "Every specialist this team can act as. None of these is separately",
        "spawnable — the team lead adopts one by taking its role below and",
        "working under that name, printing it in the activation banner.",
        "",
        f"## Core roster ({len(agents)})",
        "",
    ]
    for a in agents:
        lines.append(f"- **{rebrand(a.get('name', ''))}** — {rebrand(a.get('role', '')).strip()}")
    if growth:
        lines += [
            "",
            f"## Growth pool ({len(growth)})",
            "",
            "Deeper specialisations in the same domain, same rules.",
            "",
        ]
        for a in growth:
            lines.append(f"- **{rebrand(a.get('name', ''))}** — {rebrand(a.get('role', '')).strip()}")
    lines.append("")
    path = os.path.join(OUT_DIR, f"{slug}.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return len(agents) + len(growth)


def main() -> int:
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    roster = os.path.join(src, "agents", "roster.json")
    if not os.path.isfile(roster):
        print(f"roster not found: {roster}", file=sys.stderr)
        print("pass the path to a ThePunisher-Agent checkout", file=sys.stderr)
        return 1
    with open(roster, encoding="utf-8") as fh:
        data = json.load(fh)

    os.makedirs(OUT_DIR, exist_ok=True)
    for stale in os.listdir(OUT_DIR):
        if stale.endswith(".md"):
            os.remove(os.path.join(OUT_DIR, stale))

    teams = data.get("teams") or []
    total = 0
    for t in teams:
        total += write_team(
            t.get("slug", ""),
            t.get("name", ""),
            t.get("purpose", ""),
            t.get("agents") or [],
            t.get("growth_agents") or [],
        )
    index = [
        "# Pulse Agent specialists",
        "",
        f"{total} named specialists across {len(teams)} teams, one file per team.",
        "",
        "A team lead adopts a specialist by reading its team's file here and",
        "taking that role inline. They are deliberately not registered as native",
        "subagents: 5,050 descriptions exceed Claude Code's budget by over 20x.",
        "",
    ]
    for t in teams:
        agents = (t.get("agents") or []) + (t.get("growth_agents") or [])
        index.append(f"- `{t.get('slug','')}.md` — {rebrand(t.get('name',''))} ({len(agents)})")
    index.append("")
    with open(os.path.join(OUT_DIR, "README.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(index))

    print(f"wrote {len(teams)} team files, {total} specialists -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
