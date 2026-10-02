#!/usr/bin/env python3
"""What the agent bundle costs you on every single turn, and where it goes.

Five things ship into a session before the user has asked anything: the team-lead
`description` fields (the host loads all of them so it can route), the skill
catalogue (name + description per installed skill), the merged main-session block
in CLAUDE.md / AGENTS.md, the MCP tool schemas of our two servers (every tool's
name, description and parameters, sent on every turn), and the SessionStart hook
note. Codex, Qwen Code, Cursor and opencode also read the project AGENTS.md block
on top. Everything else -- specialist rosters, ECC, the design systems, the agency
roles -- is read on demand and costs nothing until it is called.

The MCP schemas and the hook note used to be left out of this meter, which is how
the tracker's tool descriptions could grow by a third without anything noticing.

That always-on part is paid on every turn of every session in every project, so a
sentence added there is not a one-off cost. This prints the split, and with
--check fails when it creeps past the ceiling.

    python3 ide/token-cost.py            # the report
    python3 ide/token-cost.py --check    # non-zero exit if over the ceiling
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
# For a Claude Code session, everything above included. Lowered from 17,000 when
# the MCP schemas and hook note were added to the count and the roster,
# schemas, note and project block were cut (0.97.0): the old total left those
# out, so the real number was ~20.6k against a ceiling that read 15.7k.
CEILING_TOKENS = 16500


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


def project_block_chars() -> int:
    src = (ROOT / 'ide/overlay/src/main/planide/agent-bundle.ts').read_text(encoding='utf-8')
    i = src.index('function projectAgentsBlock')
    j = src.index('\n}', i)
    return len('\n'.join(re.findall(r"^\s*'(.*)',?$", src[i:j], re.M)))


def mcp_schema_chars() -> tuple[int, int]:
    """tools/list of both servers, exactly as an agent receives it."""
    import json, shutil, subprocess
    node = shutil.which('node')
    if not node:
        raise SystemExit('token-cost: needs node to measure the MCP tool schemas')
    total = count = 0
    frames = ('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
              '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n')
    for server in ('planide-mcp.mjs', 'pulsar-tools-mcp.mjs'):
        out = subprocess.run([node, str(ROOT / 'ide/agent-bundle/tracker/mcp' / server)],
                             input=frames, capture_output=True, text=True, timeout=60).stdout
        for line in out.splitlines():
            msg = json.loads(line)
            if msg.get('id') == 2:
                for tool in msg['result']['tools']:
                    total += len(json.dumps(tool))
                    count += 1
    return total, count


def hook_note_chars() -> int:
    """The tracker note the SessionStart bootstrap adds (the resume brief is
    on top, but only when a board has open work, and is sized by it)."""
    src = (ROOT / 'ide/agent-bundle/hooks/graphify-bootstrap.sh').read_text(encoding='utf-8')
    m = re.search(r'^\s*NOTE="(.*)"\s*$', src, re.M)
    return len(m.group(1)) if m else 0


def main() -> int:
    roster, leads = roster_chars()
    skills, n_skills = skills_chars()
    block = main_block_chars()
    mcp, n_tools = mcp_schema_chars()
    note = hook_note_chars()
    project = project_block_chars()
    rows = [
        (f'team-lead descriptions ({leads})', roster),
        (f'skill catalogue ({n_skills})', skills),
        ('main-session block', block),
        (f'MCP tool schemas ({n_tools})', mcp),
        ('SessionStart note', note),
    ]
    total = sum(c for _, c in rows)
    print('Always-on cost -- paid on every turn, in every session:\n')
    for label, c in rows:
        print(f'  {label:32} {c:7,} chars  ~{tokens(c):6,} tokens')
    print(f'  {"":32} {"":7}        {"-" * 13}')
    print(f'  {"TOTAL":32} {total:7,} chars  ~{tokens(total):6,} tokens')
    print(f'\n  ceiling {CEILING_TOKENS:,} tokens -- headroom {CEILING_TOKENS - tokens(total):,}')
    print(f'\n  + project AGENTS.md block   {project:7,} chars  ~{tokens(project):6,} tokens'
          '  (Codex, Qwen, Cursor, opencode read it on top)')
    print('\nRead on demand, costing nothing until called: the specialist roster,')
    print('ECC, the 152 design systems, ThreeUI, the 274 agency roles.')
    if '--check' in sys.argv and tokens(total) > CEILING_TOKENS:
        print(f'\nOVER CEILING by {tokens(total) - CEILING_TOKENS:,} tokens', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
