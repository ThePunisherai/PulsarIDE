# Vendored copy — attribution & provenance

This directory is a **scoped copy** of the real skill payload from:

- **Upstream repo:** https://github.com/eugeniughelbur/obsidian-second-brain
- **Commit vendored:** `c1e47c3739a01bc1b516cbc45ed73515bf965755`
- **Date vendored:** 2026-07-28
- **Skill count at vendor time:** 1 skill (`skills/obsidian-second-brain/`) — upstream ships
  a single `SKILL.md` at its own repo root (no `skills/` subdirectory upstream, matching
  Claude Code's own documented "single `SKILL.md` at plugin root = single skill" convention),
  wrapped here as `skills/obsidian-second-brain/` to match this repo's flat-`skills/`-directory
  convention for every vendored library.

## What was vendored, and what was deliberately left out

Vendored: `SKILL.md` (the skill manifest itself) plus the directories it directly depends on
to function — `commands/` (the `/x-read`, `/research`, `/notebooklm`, etc. command
definitions the SKILL.md's own frontmatter references), `scripts/` (the Python vault
read/write/reconcile helpers), `references/` (vault-schema, write-rules, freshness-policy
docs the skill's own operation follows), `hooks/` (session-start/background-agent hook
definitions), and `adapters/` (per-tool bridges for Claude Code/Codex CLI/Gemini CLI/Hermes/
OpenCode/Pi — this is a genuinely cross-tool skill, not Claude-Code-only).

Deliberately NOT vendored, same "skill content only, not the whole project" scope boundary
already used for the other four libraries: `README.md`/`CHANGELOG.md`/`CONTRIBUTING.md`/
`CODE_OF_CONDUCT.md`/`SECURITY.md`/`CITATION.cff` (repo meta), `install.sh`/`update.sh`/
`pyproject.toml`/`uv.lock` (upstream's own installer, not needed here), `tests/` (upstream's
own test suite), `.github/` (CI), `docs/` (a built documentation site), `examples/`
(an illustrative sample vault, not functional skill content), and `integrations/` (three
genuinely separate standalone side-projects bundled in the same repo — a Telegram journal
bot, a real Obsidian community plugin, and a standalone MCP server — each a real, sizeable
project in its own right rather than something the skill itself needs to operate; not
vendored in this pass to keep scope tight, a candidate for its own separate evaluation later
if there's a concrete reason to wire one in).

## License

MIT — see `LICENSE` (Copyright (c) 2026 Eugeniu Ghelbur).

## Why this one, specifically

Directly relevant to this repo's own existing Obsidian auto-notes feature (see CLAUDE.md's
"Obsidian auto-notes" history) — this skill is a much richer, actively-maintained
implementation of the same idea (an AI-maintained, self-rewriting vault) than this repo's own
one-note-per-project convention. Cataloged (catalog-only) in `integrations/repos.json` before
this vendoring pass; deliberately not wired into `install.sh`'s default deploy or the
dashboard's own Obsidian integration in this pass — that's a deeper design decision (would
this skill's own vault-maintenance behavior conflict with or duplicate this repo's existing
auto-notes convention?) that deserves its own evaluation, not an assumption made while simply
vendoring the content offline.
