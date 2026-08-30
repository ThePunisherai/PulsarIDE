# agency-agents (vendored)

- **Upstream:** https://github.com/msitarzewski/agency-agents
- **Vendored commit:** `3c9588880b7cafaec325a104899fd8bbe27e7d72`
- **Vendored on:** 2026-08-30
- **License:** MIT (see `LICENSE`, © 2025 AgentLand Contributors)

## What is here

274 role agents across 19 divisions — engineering, design, marketing, security,
product, testing, game development, GIS, healthcare, finance, spatial computing
and more. Each is a real `.md` with `name` / `description` frontmatter and a full
persona body, the same shape as PulsarIDE's own team leads.

`divisions.json` is upstream's own index of the divisions and is kept as-is.

## What was left out, and why

`README.md` is kept (it explains the divisions). Repo meta an agent should never
read is not vendored: `CONTRIBUTING*.md`, `SECURITY.md`, `.github/`, and
upstream's own `scripts/`.

Note on the count: upstream's README says "296". Counting files that actually
carry `name:` frontmatter -- i.e. real, usable roles -- gives 274 across 19
division directories, and that is the number used here and in the manifest.

## How these are used here — and why they are NOT registered as subagents

They are deployed to `~/.config/pulsaride/agency-agents/<division>/<name>.md` and
read off disk by whichever agent needs one, adopted inline.

They are deliberately **not** installed as individually-registered Claude Code /
Gemini / Codex subagents. That is not an oversight: Claude Code caps the total
size of all subagent `description` fields at ~15k tokens, and this project has
already shipped that exact break once (v0.26.0, "subagents suddenly stopped
working") by registering too many. PulsarIDE's own 101 team leads already use
~10.3k of that budget; 296 more descriptions would blow it several times over and
break subagents for everything, including the tracker.

So the same rule the 5,372 specialists already follow applies here: the Council
routes to one by name, then reads that file and adopts it. Same capability, no
budget cost.
