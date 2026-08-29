# prompt-master — vendored

- **Upstream:** https://github.com/nidhinjs/prompt-master
- **Vendored commit:** `2bd92518e26bf659e21e3d9ab90573fcf3ddeccb`
- **Vendored on:** 2026-08-29
- **Licence:** MIT (`LICENSE`, kept verbatim alongside the skill)

## What is included

`SKILL.md` and `references/{templates,patterns}.md`, exactly as upstream ships
them. That is the whole skill: 13 prompt templates, profiles for 30+ AI tools,
and the anti-patterns it checks against.

## What is excluded, and why

`README.md` only — it is repository documentation (how to download the ZIP and
upload it to claude.ai), not part of the skill the agent loads. Nothing about
the skill's behaviour lives in it.

## Why it is here

PulsarIDE runs several agents that all take a written prompt, and the skill's
own activation rule is narrow: it fires only when the user explicitly asks to
write or improve a prompt, so it costs nothing the rest of the time.
