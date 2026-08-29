# archify — vendored

- **Upstream:** https://github.com/tt-a1i/archify
- **Vendored commit:** `0853a805003514776bef3593ecca091409828902` (v2.16.0-dev.0)
- **Vendored on:** 2026-08-29
- **Licence:** MIT (`LICENSE`, kept verbatim)

## What is included

The `archify/` package upstream ships as its skill: `SKILL.md`, `bin/`,
`renderers/`, `schemas/`, `recipes/`, `references/`, `assets/`, `brand-marks/`,
`delta/`, `scripts/`, and the 14 JSON examples. It declares **no runtime
dependencies**, so it runs on the IDE's own Node with nothing to install.

## What is excluded, and why

- `test/` (1.2 MB) — the upstream test suite, of no use at runtime.
- `examples/*.html` (3.5 MB) — pre-rendered outputs of the JSON examples beside
  them. They are regenerable by running archify, and each is ~700 KB. The JSON
  inputs are kept (96 KB total) because they are what an agent reads to learn
  the schema.
- `package-lock.json` — nothing to install; the package has no dependencies.

Everything outside `archify/` in the upstream repo (docs, benchmarks,
experiments, integrations, the repo's own READMEs) is repository material rather
than part of the skill.
