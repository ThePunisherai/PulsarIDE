# Vendored copy — attribution & provenance

This directory is a **verbatim, unmodified copy** of the real skill directory from:

- **Upstream repo:** https://github.com/conorluddy/ios-simulator-skill
- **Commit vendored:** `e0ee87a884b438632238ef8ab42139797f8638a8`
- **Date vendored:** 2026-07-28
- **Skill count at vendor time:** 1 skill (`skills/ios-simulator-skill/`), a single-skill
  repo — verified by inspecting the real upstream layout after cloning
  (`ios-simulator-skill/skills/ios-simulator-skill/SKILL.md` at the repo root), not guessed.
- Only the `skills/ios-simulator-skill/` directory (`SKILL.md` + its `scripts/` — 31 real
  Python/shell helper scripts for `xcodebuild`/`xcrun simctl`/`idb` automation) was vendored —
  upstream also ships `references/`, `site/` (a built docs site), `tests/`, and packaging
  files (`pyproject.toml`) this repo doesn't need, same scope boundary already used for the
  other vendored skill libraries.

## License

MIT — see `LICENSE` (Copyright notice per upstream `LICENSE.md`).

## Why this one, specifically

No existing team in `agents/roster.json` covers iOS-simulator-specific tooling in depth —
`ios-engineering`'s core roster covers the broader iOS product lifecycle (SwiftUI/UIKit,
App Store submission, HIG compliance) but not this skill's specific niche: token-efficient
`xcodebuild` wrapping and accessibility-based (not pixel-coordinate) simulator UI navigation
for driving an app from an agent session. Cataloged (catalog-only) in `integrations/repos.json`
before this vendoring pass; no offensive-security or otherwise risky content — verified by
inspecting `SKILL.md` and every script under `scripts/` before vendoring.
