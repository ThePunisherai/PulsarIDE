# Vendored copy — attribution & provenance

This directory is a **verbatim copy, following upstream's own documented install
payload rules**, of:

- **Upstream repo:** https://github.com/Emily2040/seedance-2.0
- **Commit vendored:** `6c51262377b96592b9f87a8c8b0219e6335378f7`
- **Date vendored:** 2026-07-28
- **Skill count at vendor time:** 1 skill (`skills/seedance-20/`) — see "Why one skill,
  not 29" below.

## Why one skill, not 29

Upstream ships 28 nested `SKILL.md` files under its own `skills/` directory (camera,
motion, lighting, character, style, VFX, audio, prompt-writing, multilingual vocab, ...)
plus a root `SKILL.md` (`name: seedance-20`) that routes between them via `[skill:...]`/
`[ref:...]` tags and a shared `references/`/`data/`/`schemas/`/`scripts/` pool. This
looked at first like a flat 29-skill library matching this repo's other vendored
libraries' layout — but upstream's own `scripts/install_codex_skill.py` says otherwise:
it `shutil.copytree()`s the **entire repo** (component skills, shared references, data,
schemas, and scripts all together) into a single `~/.codex/skills/seedance-20/`
directory. Upstream's own authoritative answer to "what is one deployable skill here" is
the whole tree, not each nested `SKILL.md` independently — the 28 sub-skills are meant to
be loaded as internal files *within* the parent `seedance-20` skill, not as 28 separate
top-level Claude Code skills. Vendored to match that reality exactly, rather than
guessing at a flatter layout that would have silently broken every sub-skill's shared
reference/data/schema dependencies once deployed.

## What was included / excluded

Followed upstream's own `install_codex_skill.py` ignore list exactly (not a separate,
guessed-at scope decision): excludes `.git`, `.github`, `.pytest_cache`,
`.seedance_backups`, `__pycache__`, `eval_run.py` (development-only, network-capable —
upstream's own comment: "contacts a model provider and reads ANTHROPIC_API_KEY; nothing
in skills/ or references/ invokes it"), `eval-runs/`, `tests/`, and `*.pyc`/`*.pyo`/
`*.tmp`/`*.log`/`*.png`/`*.jpg`/`*.jpeg`/`*.psd` (compiled/temp files and marketing
images — hero shots, infographics). Everything else — `skills/`, `references/`, `data/`,
`schemas/`, `scripts/` (minus the one excluded file), `docs/`, `evals/`, `examples/`,
`validation/`, `agents/`, plus the repo's own `SKILL.md`/`README.md`/`CHANGELOG.md`/
`SECURITY.md`/`V6_SEQUENCE_PROMPT_COMPILER_MANIFEST.md` — is included, exactly matching
what upstream's own installer would deploy.

## License

MIT — see `LICENSE` (Copyright (c) 2026 Iamemily2050 (@iamemily2050)).

## Content review before vendoring

`seedance-copyright` and `seedance-antislop` are real, dedicated safety/governance
skills — checked directly, not assumed: `seedance-copyright` exists specifically to
rewrite prompts touching protected IP/named brands/public figures/lookalike requests
into "original, authorized, and safer production language," and the broader skill set's
own stated design principles (multilingual, source-dated platform facts, IP-safe
rewrites) are defensive/safety-oriented throughout. No offensive-security, NSFW, or
deepfake-enabling content found anywhere in the vendored tree.

## Deploying this one

This library's single entry (`seedance-20`) is registered the same way as every other
vendored skill directory — `install.sh`/`Install.ps1`'s `--full-skills-library` search
order copies whichever `skills/<name>` directories exist under each library, and
`seedance-20` is the whole functional payload in one self-contained directory, so it
deploys cleanly with zero special-casing needed.
