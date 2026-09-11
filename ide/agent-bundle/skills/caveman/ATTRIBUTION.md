# caveman — vendored skill

Upstream: https://github.com/JuliusBrussee/caveman
Vendored commit: `15581d14007fd01fb3f132016741962f34936ca2`
Vendored: 2026-09-11
License: **MIT** (see `LICENSE`)

## What was taken, and what deliberately was not

Only `skills/caveman/` — `SKILL.md` and its `README.md`. Upstream's own
`LICENSING.md` is explicit that `skills/` is MIT ("Existing Caveman skill stays
MIT and untouched"), which is the half vendored here.

**The proxy was deliberately NOT taken**, for two independent reasons, either of
which alone would be enough:

1. **Licence.** `proxy/`, `engine/`, `rewriter/` and `browse/` are BSL-1.1, not
   MIT. Vendoring them into this installer is not ours to do.
2. **It sits in the request path.** Caveman's proxy saves input tokens by
   standing between the agent and its provider. PulsarIDE's users sign in with
   their Claude / Codex / Antigravity **account**, not an API key, and this
   project already has the scar from exactly that shape: Headroom's proxy forced
   a fresh OAuth login on Codex ChatGPT-auth users and broke their sessions. A
   token saving is not worth breaking the login.

## Why this half is safe

`SKILL.md` is prose. It carries no command, no endpoint, no key, no dependency —
verified by grep before vendoring (zero hits for `proxy`, `localhost`,
`ANTHROPIC_BASE_URL`, `API_KEY`, `npm install`). It changes how an agent *writes*,
which is where its ~65% output-token saving comes from, and it cannot touch
authentication because it never leaves the prompt.

It is also opt-in: its own description triggers on `/caveman`, "caveman mode" or
"be brief", so it costs a listing entry and nothing more until asked for.
