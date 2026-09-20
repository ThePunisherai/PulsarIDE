# baoyu-design — attribution & provenance

- **Upstream:** https://github.com/JimLiu/baoyu-design
- **Commit:** `026d4ea012bdd5cada72ac8cc13f21ba4edf2245`
- **Vendored:** 2026-09-20
- **License:** MIT (see `LICENSE`, verbatim; Copyright (c) 2026 Jim Liu)

Runs Claude-Design-style work locally as an Agent Skill: design artifacts as
self-contained HTML (mockups, prototypes, wireframes, landing pages, dashboards, decks),
plus offline import of a local Figma `.fig` file with no Figma account or MCP.

## One deliberate modification

The upstream frontmatter `description` is 1001 characters. PulsarIDE builds a skill
catalog from every bundled skill's name + description and the hosts cap it at 8000
characters -- adding this verbatim would have pushed the catalog over that cap and made
the host silently shorten *every* skill's description (a real, previously-reported bug,
fixed in v0.87.0). The description here is therefore rewritten to ~380 characters,
keeping the trigger phrases (mockup, prototype, wireframe, landing page, dashboard, app
screen, slide deck/PPT, resume, diagram, Figma .fig) and dropping the long enumeration.
Nothing else in the skill is changed.

## Why `agents/vendor/` is kept

`babel.min.js`, `react`/`react-dom` production builds, `fflate.mjs` and
`fig-materialize.mjs` (3.5 MB) are what let `build-preview.mjs`,
`compile-design-system.mjs` and `import-figma.mjs` run **offline, with no account and
no API key**. Dropping them to save space would break exactly the property that makes
this skill fit this project.
