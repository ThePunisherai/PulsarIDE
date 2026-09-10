# ECC — vendored catalogue

Upstream: https://github.com/affaan-m/ECC
Vendored commit: `928c1dea72f5c330442fc1f595563398b8f389f7`
License: MIT (see `LICENSE`, copied verbatim from upstream)

## What is here, and what is not

Only the two trees the `ecc_find` / `ecc_read` tools actually read:

- `skills/<name>/SKILL.md` — 291 skills
- `agents/<name>.md` — 68 agents

Deliberately not vendored: `assets/` (23M), `docs/` (18M), `tests/`, `scripts/`,
`ecc2/`, `examples/`, `rules/`, `commands/` and repo meta. They are real parts of
upstream, but nothing in this IDE reads them, and they are 56M of the 64M — the
whole point of bundling was to make ECC present without making the installer
carry a repository.

## Why it is bundled at all

ECC used to be fetched on first launch (`claude plugin marketplace add`, falling
back to `git clone`). That needs the Claude CLI or git plus network, and when it
failed it left a marker that stopped it retrying — which is exactly how a user
ends up looking at "ECC: not fetched yet" forever. On disk in the installer it is
simply there.

It is still NOT installed as a Claude Code plugin: that costs ~40,600 always-on
tokens in every session on every project (measured with `claude plugin details`).
It is a catalogue searched through tools, so it costs nothing until called.
