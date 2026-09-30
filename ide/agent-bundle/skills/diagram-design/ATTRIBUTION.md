# diagram-design -- attribution & provenance

Vendored into PulsarIDE's agent bundle from:

- **Upstream:** https://github.com/cathrynlavery/diagram-design
- **Commit:** `57148ac6f7cf8f2d0080f23437ab2929bca15f3e`
- **Vendored:** 2026-09-30
- **License:** MIT (see `LICENSE`, verbatim)

## What it is

Editorial diagram types (40+) as self-contained HTML/SVG/PNG for Claude Code and other skill hosts, with .drawio/.mermaid/.excalidraw import.

## What was vendored, and what was not

Vendored: SKILL.md, references/ (every diagram type and the import/export docs) and scripts/ (five pure-stdlib Python helpers: drawio/excalidraw/mermaid extract, export_svg, self_check).

**Left out:** the upstream `assets/` example gallery (~2.7 MB of demo HTML), and the top-level `commands/`, `prompts/` and `docs/` -- none needed to use the skill. `scripts/export_svg.py` shells out to a headless browser only for PNG; HTML and SVG output need nothing but Python's standard library, and no script makes a network request.
