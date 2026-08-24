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
- `skills/` — 48 curated skills, the same default set ThePunisher-Agent deploys,
  including the orchestration meta-skills (`agent-orchestrator`, `dispatch`,
  `antigravity-skill-orchestrator`). Vendored from several upstream libraries,
  each under its own permissive licence (MIT / CC-BY-4.0) — see the per-library
  `ATTRIBUTION.md` files in ThePunisher-Agent's `skills-library/`.
- `hooks/` — the graphify knowledge-graph bootstrap (`graphify-bootstrap.sh` /
  `.ps1`) and the Obsidian/council memory writer (`council-memory.py`), wired to
  run per project so graphify and Obsidian are used for every project.

## Licences

ThePunisher-Agent's own content is under its repository licence; the vendored
skills keep their upstream MIT / CC-BY-4.0 licences. PulsarIDE bundles them
verbatim and does not relicense them.
