# ThePunisher Team Subagents

Each file here is a **real, loadable subagent** (Claude Code `.claude/agents/*.md` format: YAML
frontmatter with `name` + `description`, optional `tools`, then the system prompt). The Council
(`council.md`) routes tasks to these teams; `install.sh` copies them into `~/.claude/agents/` so
Claude Code can dispatch to them by name or automatically via their `description`.

| File | Subagent | Role |
| ---- | -------- | ---- |
| `council.md` | `thepunisher-council` | Orchestrate + fact-check + anti-hallucination |
| `brainstorm.md` | `thepunisher-brainstorm` | Ideation & architecture options |
| `task-management.md` | `thepunisher-task-management` | Decompose, plan, track |
| `coding.md` | `thepunisher-coding` | All-language implementation |
| `reverse-engineering.md` | `thepunisher-reverse-engineering` | Binary/malware/protocol RE (x64dbg+Scylla, Ghidra, Frida) |
| `debug.md` | `thepunisher-debug` | Reproduce → root-cause → fix |
| `testing-qa.md` | `thepunisher-testing-qa` | Tests & quality gates (TDD) |
| `learning.md` | `thepunisher-learning` | Capture lessons, prevent recurrence |
| `web-frontend.md` | `thepunisher-web-frontend` | Premium accessible UI |
| `backend-api.md` | `thepunisher-backend-api` | APIs, data, auth, services |
| `security-pentest.md` | `thepunisher-security-pentest` | Audits, threat models, authorized pentest |
| `devops.md` | `thepunisher-devops` | CI/CD, IaC, containers, monitoring |
| `code-review.md` | `thepunisher-code-review` | Deep review + refactor (YAGNI) |
| `ai-ml.md` | `thepunisher-ai-ml` | LLM/RAG/agents/ML |
| `specialized-creative.md` | `thepunisher-specialized-creative` | Games, 3D, shaders, docs, Obsidian |

The single-file `agents/thepunisher.md` remains the master orchestrator persona and full roster
(the 95 named agents live inside these 15 teams; 279 total with the two optional vendored agent
libraries — see `agents-library/` and `CLAUDE.md`). These team files make the teams
**dispatchable** in tools that support subagents, without shipping hundreds of stub files (that
would violate the system's own YAGNI/ponytail rule).
