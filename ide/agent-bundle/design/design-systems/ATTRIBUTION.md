# design-systems — attribution & provenance

152 ready-to-use brand design systems, vendored into PulsarIDE's agent bundle from:

- **Upstream:** https://github.com/nexu-io/open-design
- **Commit:** `ac6115406f3f780ef5c624a9aad1a87cbbad882a`
- **Vendored:** 2026-09-20
- **License:** Apache-2.0 (see `LICENSE`, verbatim)

## What this is

Each directory is one brand-grounded design system: a `DESIGN.md` (the full visual
language -- theme, palette with real hex values, type scale, spacing, component grammar,
and the *rationale*, so an agent can stay on-system in a case the file never names) plus
`tokens.css` (the same system as ready-to-paste CSS custom properties).

`catalog.json` is generated from each `DESIGN.md`'s own title/category/summary headers,
so `design_find` searches real descriptions rather than directory names.

## What was vendored, and what was left out

Vendored per system: `DESIGN.md` + `tokens.css` -- the portable, agent-actionable core
(3.7 MB for all 152).

Left out: `preview/`, `source/`, `system/`, `components.html`,
`components.manifest.json`, `design-tokens.json`, `tailwind-v4.css` and `USAGE.md`.
Upstream's full `design-systems/` tree is 42 MB; most of that is rendered previews and
scraped source captures that an agent never reads. `design-tokens.json` was skipped
specifically because `tokens.css` already carries the same token set in the form a
project actually consumes.

The rest of the upstream repo (the Electron desktop app, its 232 plugin skills, the
release tooling) is deliberately NOT vendored -- PulsarIDE has its own agent, skills and
Council, so only the design-system library itself was taken.

## Trademark note

These systems are *inspired by* the named brands and were derived from public web
surfaces. The brand names identify the aesthetic; they are not an endorsement, and the
tokens are a reimplementation, not an official brand asset. Use them as a starting
direction, and follow the real brand's own guidelines when building for that brand.
