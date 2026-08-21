# Vendored copy — attribution & provenance

This directory is a **verbatim, unmodified copy** of the `agents/` directory, `LICENSE`, and
`README.md` from:

- **Upstream repo:** https://github.com/vijaythecoder/awesome-claude-agents
- **Commit vendored:** `2050f3c60fcfea497f7b6b3ec6566cc316367a7e`
- **Date vendored:** 2026-07-10
- **Subagent count at vendor time:** 33, verified by counting real `.md` files under `agents/`
  (3 orchestrators, 4 core, 4 universal, 22 framework-specialized across Laravel, Django, Rails,
  React, Vue, and the Python ecosystem)
- **License:** MIT — see `LICENSE`.

## Format

Each `agents/<category>/<agent-name>.md` is a standard Claude Code subagent file (`name`/
`description` frontmatter + system prompt body) — the same format as
`agents/subagents/<team>/*.md` in this repo.

## Why this is vendored

Distinctive coverage vs. what's already in `agents-library/voltagent-subagents/`: this is a
framework-orchestrator pattern (a `tech-lead-orchestrator` that routes to per-framework
specialists) rather than VoltAgent's flat 10-category catalog, and it covers specific ORM/web
framework combinations (Laravel+Eloquent, Django+ORM, Rails+ActiveRecord, Vue+Nuxt) that neither
VoltAgent's library nor ThePunisher's own 95-agent roster name individually.

## Collisions with the other vendored library

3 filenames collide with `agents-library/voltagent-subagents/categories/`: `backend-developer.md`,
`code-reviewer.md`, `frontend-developer.md`. `install.sh` / `Install.ps1` deploy
`voltagent-subagents` first, so its copy wins the slot for these three (first-vendored-wins, same
policy as the skills libraries — not a quality judgment, both copies stay on disk here). No
collisions were found against ThePunisher's own 95 hand-crafted subagents.

## Deploying these

`install.sh` / `Install.ps1` deploy these into `~/.claude/agents/` only with the opt-in
`--full-agent-library` / `-FullAgentLibrary` flag, alongside `voltagent-subagents` — not by
default, to avoid silently doubling the agent count for everyone who just wants ThePunisher's own
roster.

## Keeping this in sync

```bash
git clone --depth 1 https://github.com/vijaythecoder/awesome-claude-agents.git /tmp/vijaythecoder-src
rsync -a --delete /tmp/vijaythecoder-src/agents/ agents-library/vijaythecoder-claude-agents/agents/
cp /tmp/vijaythecoder-src/LICENSE /tmp/vijaythecoder-src/README.md agents-library/vijaythecoder-claude-agents/
```

Update the commit hash/date above after refreshing.
