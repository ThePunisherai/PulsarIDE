# Vendored copy — attribution & provenance

This directory contains the **skills only** from wshobson/agents' `plugins/*/skills/<name>/`
tree, copied verbatim (each `SKILL.md` + any `references/` subfolder untouched) — the agents half
of that same upstream repo is vendored separately at `agents-library/wshobson-agents/` (see that
directory's own `ATTRIBUTION.md`), since this repo keeps skills and agents in separate top-level
directories and upstream interleaves them per-plugin.

- **Upstream repo:** https://github.com/wshobson/agents
- **Commit vendored:** `c4b82b0ad771190355eb8e204b1329732a18449a` (refreshed from
  `2de74ac1c8f6669821dcef13153332c3168033c1`, vendored 2026-07-12 — upstream genuinely grew from
  162 to 180 skills)
- **Date vendored:** 2026-07-28 (refresh)
- **Skill count at vendor time:** 180 real `skills/<name>/SKILL.md` directories across 83 plugin
  directories, verified by counting the real directories after cloning, flattened into this
  library's own `skills/<name>/` layout (matching `antigravity-awesome-skills` and
  `jeffallan-claude-skills`'s own flat `skills/<name>/` convention) since no two skill names
  collided with each other inside this same upstream repo (re-checked at refresh time — still 0
  intra-repo dupes, so flattening lost nothing).

## License

MIT — see `LICENSE` (Copyright (c) 2024 Seth Hobson).

## Name collisions

Checked against this repo's existing skill sources at refresh time:
- **122 of 180** skill names collide with `antigravity-awesome-skills` and/or
  `jeffallan-claude-skills` (both vendored earlier) — per this repo's established
  first-vendored-wins convention, `antigravity-awesome-skills` keeps the slot for any colliding
  name; this directory's copy stays on disk either way, nothing is deleted. Same absolute
  collision count as before the refresh (122), even though the total grew, since all of the new
  skills happened to be net-new names.
- **58 net-new unique names** (up from 40) are not present anywhere else in this repo.

`install.sh` / `Install.ps1` deploy these into the skills target only with the opt-in
`--full-skills-library` / `-FullSkillsLibrary` flag, same as the other two vendored skill
libraries.
