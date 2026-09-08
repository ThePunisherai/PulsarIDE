# PulsarIDE agent bundle — attribution

These assets are pre-installed into PulsarIDE so the CLI agents running inside it
(Claude Code, Codex, Gemini/Antigravity, Cursor) have the Pulsar agent system's
team leads and skills available in every project, with no separate dashboard or install step.

## What's here

- `agents/` — the 100 team-lead subagents (rebranded to Pulse Agent) from
  [`ThePunisherai/ThePunisher-Agent`](https://github.com/ThePunisherai/ThePunisher-Agent)
  (same owner as PulsarIDE). These are the routable team leads; the 5,050
  specialist subagents are **not** bundled — deploying all of them as native
  subagents would blow Claude Code's agent-description context budget, which is
  ThePunisher-Agent's own documented lesson. A team lead reads and adopts a
  specialist on demand.
- `skills/` — 77 curated skills, including the orchestration meta-skills
  (`agent-orchestrator`, `dispatch`, `antigravity-skill-orchestrator`). Vendored
  from several upstream libraries, each under its own permissive licence
  (MIT / CC-BY-4.0) — see the per-library `ATTRIBUTION.md` files in
  ThePunisher-Agent's `skills-library/`, plus the separate library below.

  52 of these come from ThePunisher-Agent's own default set. The other 25 are
  [`mblode/agent-skills`](https://github.com/mblode/agent-skills), MIT, vendored
  verbatim at commit `36c52bf9f6684ac84789eb544c10bad0c12c219b` (2026-09-08) —
  licence kept at `licenses/mblode-agent-skills-LICENSE.md`. They cover shipping
  (`planning`, `pr-reviewer`, `pr-creator`, `pr-babysitter`, `tidy`, `autoship`),
  design (`product-design`, `ui-design`, `ui-verification`, `ui-animation`,
  `presentation-creator`), audits (`ax-audit`, `dx-audit`, `typography-audit`,
  `seo`), architecture (`codebase-architecture`, `scaffold-nextjs`,
  `scaffold-cli`, `multi-tenant-architecture`), writing (`docs-writing`,
  `readme-creator`, `eli5`) and authoring (`agents-md`, `agent-skills-creator`,
  `save-md`). Zero of the 25 collided with a name already here, so nothing was
  shadowed or dropped. Upstream also ships `.claude-plugin/` and `maintenance/`
  metadata and a `skills add` installer route; neither is vendored — PulsarIDE
  deploys the skill directories itself, so the installer would be a second,
  competing mechanism.
- `hooks/` — the graphify knowledge-graph bootstrap (`graphify-bootstrap.sh` /
  `.ps1`) and the Obsidian/council memory writer (`council-memory.py`), wired to
  run per project so graphify and Obsidian are used for every project.

## Licences

ThePunisher-Agent's own content is under its repository licence; the vendored
skills keep their upstream MIT / CC-BY-4.0 licences. PulsarIDE bundles them
verbatim and does not relicense them.
