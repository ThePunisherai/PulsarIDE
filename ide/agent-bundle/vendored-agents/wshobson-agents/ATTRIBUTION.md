# Vendored copy — attribution & provenance

This directory contains the **agent files only** from wshobson/agents' `plugins/*/agents/*.md`
tree, copied verbatim (frontmatter and body untouched) — the skills half of that same upstream
repo is vendored separately at `skills-library/wshobson-agents-skills/` (see that directory's own
`ATTRIBUTION.md`), since this repo keeps agents and skills in separate top-level directories and
upstream interleaves them per-plugin.

- **Upstream repo:** https://github.com/wshobson/agents
- **Commit vendored:** `c4b82b0ad771190355eb8e204b1329732a18449a` (refreshed from
  `2de74ac1c8f6669821dcef13153332c3168033c1`, vendored 2026-07-12 — upstream genuinely grew:
  204 agent files across 83 plugins now, up from 199 across 88 -- some plugins gained/lost their
  own `agents/` subfolder between the two commits)
- **Date vendored:** 2026-07-28 (refresh)
- **Agent count at vendor time:** 204 real `.md` agent files (standard `name`/`description`/
  `model` frontmatter, Claude Code subagent format) across 83 plugin directories, verified by
  counting the real files after cloning.

## License

MIT — see `LICENSE` (Copyright (c) 2024 Seth Hobson).

## Layout: one directory per upstream plugin, not flattened

Unlike `voltagent-subagents` (flat `categories/<NN-category>/`) or `vijaythecoder-claude-agents`
(flat `agents/<category>/`), this upstream repo organizes agents inside separate "plugin"
directories (each also containing its own skills/commands/plugin manifest — only the `agents/`
subfolder of each is vendored here). We kept that per-plugin grouping
(`agents/<plugin-name>/<agent-name>.md`) rather than flattening it, since each plugin name carries
real information about what each agent is scoped to.

## Name collisions

204 files on disk resolve to **139 unique agent names** (65 files reuse a name already used by
another file elsewhere in this same upstream repo -- the same agent offered inside more than one
plugin -- both/all copies are kept, one per plugin subdirectory, nothing is deduplicated away).
Checked those 139 unique names against this repo's existing agent sources at refresh time, via a
real case-insensitive set intersection against `agents/roster.json`'s full name list (not
reasoned about) — **0 collisions** with ThePunisher's own core roster (every core agent name
carries the `ThePunisher-` prefix, e.g. `ThePunisher-Architect`/`ThePunisher-Debugger`, which
can't collide with an unprefixed vendored filename like `architect.md`; an earlier version of
this note claimed 2 core-roster collisions under those exact two names, which this refresh's
live check could not reproduce -- left corrected rather than carried forward unverified).
- **41 collisions** with the already-vendored `voltagent-subagents` / `vijaythecoder-claude-agents`
  agent names — per this repo's established first-vendored-wins convention (see those two
  directories' own `ATTRIBUTION.md`), `voltagent-subagents` was vendored first and keeps the slot
  for a colliding name; this directory's copy stays on disk either way, nothing is deleted.
- **2 collisions** with the later-vendored `agents-library/0xsteph-pentest-ai-agents/`
  (`malware-analyst`, `reverse-engineer`) — this directory was vendored first, so it keeps those
  two slots; also unaffected by this refresh.
- **98 net-new unique names** (up from 92) are not present anywhere else in this repo.

`install.sh` / `Install.ps1` deploy these into `~/.claude/agents/` only with the opt-in
`--full-agent-library` / `-FullAgentLibrary` flag, same as the other two vendored agent libraries.
