# Vendored copy — attribution & provenance

This directory is a **verbatim, unmodified copy** of the `skills/` directory from:

- **Upstream repo:** https://github.com/obra/superpowers
- **Commit vendored:** `3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9` (refreshed from
  `d884ae04edebef577e82ff7c4e143debd0bbec99`, vendored 2026-07-12 — real content changes since
  then: most `SKILL.md` files updated, `subagent-driven-development/re-review-prompt.md` and
  `using-superpowers/references/gemini-tools.md` added, `test-driven-development/
  testing-anti-patterns.md` replaced by `writing-good-tests.md`)
- **Date vendored:** 2026-07-28 (refresh)
- **Skill count at vendor time:** 14 real `skills/<name>/SKILL.md` directories, verified by
  counting the real directories after cloning — same 14 names as the original vendor pass.
- Only the `skills/` directory is vendored — upstream is a full "software development
  methodology" project (plugin manifests for multiple coding agents, hooks, an eval harness,
  installer scripts) and this repo only cares about the skill content itself, same scope
  boundary already used for the other three vendored skill libraries.

## License

MIT — see `LICENSE` (Copyright (c) 2025 Jesse Vincent).

## Important honesty note: this is 0 net-new unique skill names

All 14 skill names here (`brainstorming`, `systematic-debugging`, `test-driven-development`,
`writing-plans`, etc.) **already exist** in `skills-library/antigravity-awesome-skills/`, and a
byte-diff confirms why: antigravity-awesome-skills' own copies are visibly *derived from* these
exact upstream skills (same structure, same core text, tagged `source: community` with a few
edits — added a boilerplate "Limitations" section, `date_added` field, minor wording tweaks like
"Ultra-think" -> "Ultrathink") rather than independently written. So this directory adds **zero**
new entries to this repo's total unique-skill count.

It's still vendored anyway, for two real reasons, not for the count:
1. **Direct, unmodified, correctly-attributed originals** from the actual author (Jesse Vincent),
   rather than an anonymized "source: community" copy one hop removed.
2. **Richer supporting files** several of these skills lost in antigravity's adaptation — e.g.
   `subagent-driven-development/implementer-prompt.md` + `task-reviewer-prompt.md`,
   `brainstorming/spec-document-reviewer-prompt.md` + `visual-companion.md`,
   `writing-skills/anthropic-best-practices.md` + `persuasion-principles.md` + `render-graphs.js`.

Per this repo's established first-vendored-wins convention, `antigravity-awesome-skills` (vendored
first) keeps the deploy slot for all 14 names; this directory's copies stay on disk as the
canonical/richer originals but aren't what `--full-skills-library` actually deploys under those
names.

`install.sh` / `Install.ps1` still count and can deploy this directory (opt-in
`--full-skills-library` / `-FullSkillsLibrary`, same as the other three vendored skill libraries)
for anyone who wants the original author's versions specifically.
