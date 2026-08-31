# graph-engineer (vendored)

- **Upstream:** https://github.com/Ranteck/graph-engineer (branch `develop`)
- **Vendored commit:** `1a5c429f720053a27ee591bf5766b87b789210a2`
- **Vendored on:** 2026-08-30
- **License:** MIT (see `LICENSE`, © 2026 Denis Hugo Perafan)

## What it is

A skill that makes one model the orchestrator and arbiter and another the one
who writes, adversarially reviews and fixes the code, as a self-correcting cycle
rather than a single implement-and-hope pass. That fits PulsarIDE, which already
runs several agent CLIs side by side.

Vendored: the skill itself (`SKILL.md` + `references/`). Not vendored: the
repo's own `README.md`, `CLAUDE.md`, `AGENTS.md` and `PROJECT_CONTEXT.md`, which
are about developing that repo rather than using the skill.

## Status, stated plainly

Upstream's own README says it is **design-stage and not yet dogfooded end to
end** -- "reviewed on paper" rather than battle-tested, with its own Limitations
section. It ships here on those terms: available when a task genuinely wants an
adversarial second model, not as a default path for ordinary work.

## What we took from it beyond the skill

Its loop stops and escalates when consecutive passes produce **no net progress**,
instead of trying again. Our own anti-loop only ever caught a *repeat of the same
approach*, so an agent inventing a new approach each time for the same broken
thing was never stopped. That judgement is now in `pulsar-tools-mcp.mjs` as
`DISTINCT_APPROACH_ESCALATION`: four distinct dead ends on one problem stop the
suggestions and send it back to the user. The two rules are not the same shape --
theirs is per review-cycle and in-memory, ours is per project and durable -- but
the idea is theirs and is credited in that file.
