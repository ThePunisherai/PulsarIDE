#!/usr/bin/env python3
"""What the agent bundle costs you on every single turn, and where it goes.

Three things ship into a session before the user has asked anything: the team-lead
`description` fields (the host loads all of them so it can route), the skill
catalogue (name + description per installed skill) and the merged main-session
block in CLAUDE.md / AGENTS.md. Everything else -- specialist rosters, ECC, the
design systems, the agency roles -- is read on demand and costs nothing until it
is called.

That always-on part is paid on every turn of every session in every project, so a
sentence added there is not a one-off cost. This prints the split, and with
--check fails when it creeps past the ceiling.

    python3 ide/token-cost.py            # the report
    python3 ide/token-cost.py --check    # non-zero exit if over the ceiling

The roster is also measured the way Claude Code itself measures it, because that
is the number behind "Agent descriptions are over the 15.0k-token limit": per
agent round(len(f"{name}: {description}") / 4), summed over every agent it can
load. Ours has to leave most of that 15k to the user's own agents and plugins.
"""
import glob
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Measured the same way ide/test/agent-bundle.test.mjs measures the roster, so the
# numbers here and the number that test prints stay comparable.
CHARS_PER_TOKEN = 3.6
CEILING_TOKENS = 17000
# Claude Code's cap on all agent descriptions together, and the share of it this
# roster may take. Read off the CLI (2.1.281): the warning fires over 15000.
CLAUDE_AGENT_CAP = 15000
ROSTER_SHARE_CEILING = 9000


def tokens(n_chars: int) -> int:
    return round(n_chars / CHARS_PER_TOKEN)


def frontmatter(text: str) -> str:
    return text.split('---')[1] if text.startswith('---') else ''


def field(fm: str, name: str) -> str:
    m = re.search(rf'^{name}:\s*>?\s*\n?((?:.|\n)*?)(?=^\w+:|\Z)', fm, re.M)
    return ' '.join(m.group(1).split()) if m else ''


def roster_chars() -> tuple[int, int]:
    total = count = 0
    for f in glob.glob(str(ROOT / 'ide/agent-bundle/agents/*.md')):
        if f.endswith('README.md'):
            continue
        d = field(frontmatter(pathlib.Path(f).read_text(encoding='utf-8')), 'description')
        if d:
            total += len(d)
            count += 1
    return total, count


def roster_claude_tokens() -> int:
    """The roster as Claude Code counts it: round(len("name: description") / 4) per lead."""
    total = 0
    for f in glob.glob(str(ROOT / 'ide/agent-bundle/agents/*.md')):
        if f.endswith('README.md'):
            continue
        fm = frontmatter(pathlib.Path(f).read_text(encoding='utf-8'))
        name, d = field(fm, 'name'), field(fm, 'description')
        if name and d:
            total += round(len(f'{name}: {d}') / 4)
    return total


def skills_chars() -> tuple[int, int]:
    total = count = 0
    for f in glob.glob(str(ROOT / 'ide/agent-bundle/skills/*/SKILL.md')):
        fm = frontmatter(pathlib.Path(f).read_text(encoding='utf-8')[:6000])
        d = field(fm, 'description')
        if d:
            total += len(d) + len(field(fm, 'name'))
            count += 1
    return total, count


def main_block_chars() -> int:
    src = (ROOT / 'ide/overlay/src/main/planide/agent-bundle.ts').read_text(encoding='utf-8')
    i = src.index('function mainSessionBlock')
    j = src.index('\n}', i)
    return len('\n'.join(re.findall(r"^\s*'(.*)',?$", src[i:j], re.M)))


def main() -> int:
    roster, leads = roster_chars()
    skills, n_skills = skills_chars()
    block = main_block_chars()
    rows = [
        (f'team-lead descriptions ({leads})', roster),
        (f'skill catalogue ({n_skills})', skills),
        ('main-session block', block),
    ]
    total = sum(c for _, c in rows)
    print('Always-on cost -- paid on every turn, in every session:\n')
    for label, c in rows:
        print(f'  {label:32} {c:7,} chars  ~{tokens(c):6,} tokens')
    print(f'  {"":32} {"":7}        {"-" * 13}')
    print(f'  {"TOTAL":32} {total:7,} chars  ~{tokens(total):6,} tokens')
    print(f'\n  ceiling {CEILING_TOKENS:,} tokens -- headroom {CEILING_TOKENS - tokens(total):,}')
    cc = roster_claude_tokens()
    print(f'\nClaude Code agent-description cap: the roster takes ~{cc:,} of {CLAUDE_AGENT_CAP:,}')
    print(f'  share ceiling {ROSTER_SHARE_CEILING:,} -- leaves {CLAUDE_AGENT_CAP - cc:,} for the user\'s own agents')
    print('\nRead on demand, costing nothing until called: the specialist roster,')
    print('ECC, the 152 design systems, ThreeUI, the 274 agency roles.')
    if '--check' in sys.argv:
        failed = False
        if tokens(total) > CEILING_TOKENS:
            print(f'\nOVER CEILING by {tokens(total) - CEILING_TOKENS:,} tokens', file=sys.stderr)
            failed = True
        if cc > ROSTER_SHARE_CEILING:
            print(f'\nROSTER OVER ITS SHARE of Claude Code\'s agent cap by {cc - ROSTER_SHARE_CEILING:,} tokens',
                  file=sys.stderr)
            failed = True
        return 1 if failed else 0
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
