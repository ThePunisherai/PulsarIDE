# jevgrep — attribution & provenance

Vendored into PulsarIDE's agent bundle from:

- **Upstream:** https://github.com/dzhng/jevgrep
- **Commit:** `82ef1fd3f43161bb17395dba1e07a5338f3913db` (2026-09-29, CLI `@dzhng/jevgrep` 0.7.0)
- **Vendored:** 2026-09-30
- **License:** MIT (see `LICENSE`, verbatim; Copyright (c) 2026 David Zhang)

## What it is

`jg` answers a question about a repository's *behaviour* — "how are retries handled when a
request times out?" — with the relevant files, reading leads and verbatim source excerpts
with line numbers, in one stdout response. It uses a model (Jev) to judge relevance across
folders, files and declarations; the calling agent still owns the reasoning, the change and
the verification. Upstream measured the same 8 of 10 SWE-bench tasks solved with and without
it, at roughly 26–30% lower agent cost (single runs, their methodology, their numbers).

## What was vendored, and what was not

Vendored: `skills/jevgrep/SKILL.md` — the public skill, byte-for-byte below a PulsarIDE bundle
note — plus this file and the license. The skill is one file upstream; nothing was dropped.

Changed: only the frontmatter `description`, shortened to fit the skills catalogue budget every
host enforces (see `ide/test/agent-bundle.test.mjs`) while keeping the trigger phrases, and
written without `: ` so strict YAML parsers accept it. The body is upstream's.

**Not vendored: the `jg` CLI.** It is an npm package (`@dzhng/jevgrep`) with its own parser
assets and a provider client. It is installed by the user, not by this bundle:

- it is published for **macOS and Linux only** (`"os": ["darwin", "linux"]`), so a native
  Windows install fails with `EBADPLATFORM`; WSL works;
- every search sends eligible source code to the model provider the user picks in `jg auth`
  (Vercel AI Gateway, TypeSafe, OpenRouter, OpenCode Zen or a custom endpoint), so turning it
  on is the user's decision, not something an IDE should do on launch.

## How PulsarIDE uses it

Council routes behavioural "where / how / why does this work" questions to it and tells team
leads to start delegated discovery with it (see `agents/council.md` and each lead's *Tools on
this machine*). The Toolkit page reports whether `jg` is on PATH and whether a provider is
saved — read back from the machine, never assumed.
