# Vendored copy — attribution & provenance

This directory is a **flattened, deduplicated copy** of the real skill content from:

- **Upstream repo:** https://github.com/alirezarezvani/claude-skills
- **Commit vendored:** `aa8d778811a557a2c28ccadda4cf3d0bd028a4cc`
- **Date vendored:** 2026-07-28
- **Skill count at vendor time:** 346 real `skills/<name>/SKILL.md` directories, verified by
  counting the real directories after cloning and flattening (see below).

## What was vendored, and why it needed flattening

Upstream organizes its 362 total `SKILL.md` files under 18 topic domains at the repo root
(`engineering/`, `c-level-advisor/`, `marketing-skill/`, `productivity/`, ...), not under a
single flat `skills/` directory the way this repo's other four vendored libraries are laid
out. This directory flattens all of them into `skills/<name>/` to match that same convention
(the one `install.sh`'s `deploy_skills()` and `scripts/generate-plugin.py`'s
`sync_curated_skills()` both already assume).

Upstream ALSO ships mirrored copies of the same skill content under `.gemini/`, `.claude/`,
`.codex/`, `.vibe/`, and `.hermes/` (its own multi-platform packaging, one copy per target
tool's own config-directory convention) — those mirror directories were excluded entirely
during vendoring, since they're the exact same content as the primary domain directories, not
additional skills. Counting only the primary (non-mirror) domain directories gives 362
`SKILL.md` files; 16 of those are themselves intra-repo duplicate skill NAMES appearing under
more than one domain (e.g. `chaos-engineering` appears once directly under `engineering/` and
once nested under `engineering/skills/`) — resolved first-occurrence-wins during the flatten
(the same directory-walk order Python's `os.walk` produces, alphabetical by domain), leaving
**346 unique skill names**. One additional nested `SKILL.md` (`skill-tester/assets/sample-skill/
SKILL.md`) is a test fixture bundled *inside* the real `skill-tester` skill's own `assets/`
directory, not a separate skill — it came along automatically as part of copying
`skill-tester/` whole, exactly as it should.

Only the 346 skill directories themselves were vendored — upstream is a full project repo
(CHANGELOG, CONTRIBUTING guide, a skill-authoring standard doc, CI workflows, marketplace
manifests for 13 different coding tools, a Python skill-installer CLI) and this repo only
cares about the skill content itself, same scope boundary already used for the other four
vendored skill libraries.

## License

MIT — see `LICENSE` (Copyright (c) 2025 Alireza Rezvani).

## Overlap with the four already-vendored libraries

49 of the 346 names here collide with a name already vendored in
`antigravity-awesome-skills`/`jeffallan-claude-skills`/`wshobson-agents-skills`/
`obra-superpowers` (e.g. `browser-automation`, `code-reviewer`, `deep-research`,
`design-system`, `seo-audit`). Per this repo's established first-vendored-wins convention,
this library is registered LAST in `install.sh`/`Install.ps1`'s search order, so those 49
existing entries keep their deploy slot and only the remaining **297 genuinely net-new**
skill names actually add to this repo's total unique-skill count. All 346 copies stay on disk
here regardless — a name losing the deploy slot to an earlier-vendored library is still a real,
inspectable, attributed copy, not deleted.

## Content review before vendoring

Every top-level domain was checked before vendoring, not assumed safe: `engineering/`
includes `security-guidance`, `secrets-vault-manager`, `env-secrets-manager`, and
`skill-security-auditor` — all genuinely **defensive** (secrets hygiene, security guidance,
auditing a skill's own safety), not offensive-security tooling. No red-team/exploit/pentest
content was found anywhere in this library, consistent with its cataloged classification as
a low-risk candidate in `integrations/repos.json` prior to this vendoring pass.
