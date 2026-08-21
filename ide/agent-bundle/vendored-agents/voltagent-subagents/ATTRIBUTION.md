# Vendored copy — attribution & provenance

This directory is a **verbatim, unmodified copy** of the `categories/` directory, `LICENSE`, and
`README.md` from:

- **Upstream repo:** https://github.com/VoltAgent/awesome-claude-code-subagents
- **Commit vendored:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Date vendored:** 2026-07-10
- **Subagent count at vendor time:** 154 (10 categories, verified by counting the real `.md`
  files — matches upstream's own "154+" claim, unlike the skills registry's inflated figure)
- **License:** MIT — see `LICENSE`.

## Format

Each `categories/<NN-category>/<agent-name>.md` is a standard Claude Code subagent file
(`name`/`description`/`tools`/`model` frontmatter + system prompt body) — the same format as
`agents/subagents/<team>/*.md` in this repo. No naming collisions were found against ThePunisher's
own 93 hand-crafted subagents (checked at vendor time).

## Why this is vendored

Same reasoning as `skills-library/`: the user explicitly asked for the full upstream registry to
be available in the repo, not just referenced by a one-line catalog entry.

## Deploying these

`install.sh` / `Install.ps1` deploy these into `~/.claude/agents/` (the real target this
upstream repo's own `install-agents.sh` also uses) only with the opt-in
`--full-agent-library` / `-FullAgentLibrary` flag — not by default, to avoid silently doubling
the agent count for everyone who just wants ThePunisher's own roster.

## Keeping this in sync

```bash
git clone --depth 1 https://github.com/VoltAgent/awesome-claude-code-subagents.git /tmp/voltagent-src
rsync -a --delete /tmp/voltagent-src/categories/ agents-library/voltagent-subagents/categories/
cp /tmp/voltagent-src/LICENSE /tmp/voltagent-src/README.md agents-library/voltagent-subagents/
```

Update the commit hash/date above after refreshing.
