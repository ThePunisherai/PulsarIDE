# Pulsar Team Subagents

Each file here is a **real, loadable subagent** (Claude Code `.claude/agents/*.md` format: YAML
frontmatter with `name` + `description`, optional `tools`, then the system prompt). The Council
(`council.md`) routes tasks to these teams; `install.sh` copies them into `~/.claude/agents/` so
Claude Code can dispatch to them by name or automatically via their `description`.

| File | Subagent | Role |
| ---- | -------- | ---- |
| `council.md` | `pulsar-council` | Orchestrate + fact-check + anti-hallucination |
| `brainstorm.md` | `pulsar-brainstorm` | Ideation & architecture options |
| `task-management.md` | `pulsar-task-management` | Decompose, plan, track |
| `coding.md` | `pulsar-coding` | All-language implementation |
| `reverse-engineering.md` | `pulsar-reverse-engineering` | Binary/malware/protocol RE (x64dbg+Scylla, Ghidra, Frida) |
| `debug.md` | `pulsar-debug` | Reproduce → root-cause → fix |
| `testing-qa.md` | `pulsar-testing-qa` | Tests & quality gates (TDD) |
| `learning.md` | `pulsar-learning` | Capture lessons, prevent recurrence |
| `web-frontend.md` | `pulsar-web-frontend` | Premium accessible UI |
| `backend-api.md` | `pulsar-backend-api` | APIs, data, auth, services |
| `security-pentest.md` | `pulsar-security-pentest` | Audits, threat models, authorized pentest |
| `devops.md` | `pulsar-devops` | CI/CD, IaC, containers, monitoring |
| `code-review.md` | `pulsar-code-review` | Deep review + refactor (YAGNI) |
| `ai-ml.md` | `pulsar-ai-ml` | LLM/RAG/agents/ML |
| `specialized-creative.md` | `pulsar-specialized-creative` | Games, 3D, shaders, docs, Obsidian |

The single-file `agents/pulsar.md` remains the master orchestrator persona and full roster
(the 95 named agents live inside these 15 teams; 279 total with the two optional vendored agent
libraries — see `agents-library/` and `CLAUDE.md`). These team files make the teams
**dispatchable** in tools that support subagents, without shipping hundreds of stub files (that
would violate the system's own YAGNI/ponytail rule).
