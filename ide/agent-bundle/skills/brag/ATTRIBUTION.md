# brag — attribution & provenance

Vendored into PulsarIDE's agent bundle from:

- **Upstream:** https://github.com/latent-spaces/brag
- **Commit:** `1f8d9ade17d0ad4419cca9305fbc1398a4dd5b39`
- **Vendored:** 2026-09-16
- **License:** MIT (see `LICENSE`, verbatim; Copyright (c) 2026 Shunit Haviv Hakimi)

## What it is

`/brag` turns the current project into a short, shareable **launch video** — it reads the
project code directly, plans and storyboards a brag concept, then hands a composition brief to
**Hyperframes** (`hyperframes.heygen.com`, a HeyGen product) to render, with music, motion and
share copy.

## What was vendored, and what was deliberately left out

Vendored: `SKILL.md`, `references/`, and `scripts/` — the skill's brains (~280 KB total).

**Left out on purpose: the upstream `assets/` folder** — a ~17 MB royalty-free media pack
(265 music `.mp3` + SFX `.ogg`/`.wav` files). PulsarIDE's entire skills bundle is ~8 MB across
78 skills; bundling this one skill's audio pack would nearly triple that and ship to every user,
so it is excluded. The skill is designed to tolerate this: its own `SKILL.md` reads a bundled
cue preset "if present, otherwise cues will be detected at composition time," and Hyperframes
selects/detects the actual audio during rendering. Anyone who wants the exact bundled cue
library can pull it from the upstream repo above.

## Real dependency, stated honestly

This skill does not render anything by itself — the final step hands off to **Hyperframes**, a
separate tool this bundle does not and cannot install. Council routes a "make a launch video"
request here (see `agents/council.md`) with that caveat: if Hyperframes isn't available, say so
rather than claim a video was produced.
