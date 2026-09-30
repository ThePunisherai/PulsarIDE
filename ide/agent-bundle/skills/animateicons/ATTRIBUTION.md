# animateicons -- attribution & provenance

Vendored into PulsarIDE's agent bundle from:

- **Upstream:** https://github.com/Avijit07x/animateicons
- **Commit:** `88ef5abab11bcac269f7b43d00f9b1eca5bdbadd`
- **Vendored:** 2026-09-30
- **License:** MIT (see `LICENSE`, verbatim)

## What it is

Over a thousand animated SVG icons for React (@animateicons/react), Lucide and Hugeicons sets, on motion/react.

## What was vendored, and what was not

Vendored: a hand-written SKILL.md (usage guidance) and the icon-name catalogue `data/lucide-icons.json` and `data/huge-icons.json`, so an agent can pick an icon offline.

**Not vendored:** the icons themselves (the npm package `@animateicons/react`, installed by the user), the Next.js website, the MCP server and the CLI. The skill is guidance only; nothing here runs or phones home.
