# spec-kit — vendored

- **Upstream:** https://github.com/github/spec-kit
- **Vendored commit:** `51e52be6c3b26fed3ff5424c671f4a559519a759`
- **Vendored on:** 2026-08-29
- **Licence:** MIT, Copyright GitHub, Inc. (`LICENSE`, kept verbatim)

## What is included

`templates/` in full: the ten command prompts under `templates/commands/` and the
spec, plan, tasks, constitution and checklist templates beside them, plus
upstream's `spec-driven.md` essay on the method. Checked before vendoring: none
of the command prompts shell out to the `specify` CLI or to `.specify/scripts`,
so the workflow works verbatim with nothing installed.

## What is excluded, and why

Upstream's Python CLI (`src/`, `pyproject.toml`), which exists to scaffold these
same files into a project and to register slash commands per agent. Installing it
needs `uv` and a Python toolchain; PulsarIDE deploys the templates directly
instead, which is the part an agent actually reads.

`SKILL.md` is ours: upstream ships this as a CLI-installed toolkit rather than a
skill, so it has none, and one is needed for an agent to discover the workflow.
Everything it points at is upstream's own content.
