---
name: council
description: Route any task to the right ThePunisher team and skills, then verify the answer before it ships. Use at the START of a non-trivial task (unclear scope, multiple approaches, a domain you are not already specialised in, or anything a specialist team would do better), and again BEFORE reporting something as done or working. Also use when asked "which team/skill should handle this".
category: orchestration
risk: safe
tags: [routing, orchestration, verification, fact-check, anti-loop, tracker]
tools: [claude, codex, antigravity, gemini, cursor]
---

# The Council

The Council is ThePunisher's routing + verification layer. It exists because **only the 15
core generalist team leads are registered as native subagents** — registering all 100 blows
Claude Code's ~15k agent-description budget (a real install hit ~36.7k tokens and every prompt
then died on the context limit). The other 85 domain-vertical teams are **fully installed on
disk** and reached through this skill on demand, at zero context cost until they are needed.

## 1. Route (do this first, in one pass)

Read the available teams — they are real files, do not guess names:

```
ls ~/.config/pulsaride/teams/            # 100 team leads, one .md each
grep -ril "<domain keyword>" ~/.config/pulsaride/teams/ | head
```

Pick by matching the task's real domain against each file's `description:` frontmatter.

- **A core team already covers it** (council, brainstorm, task-management, coding,
  reverse-engineering, debug, testing-qa, learning, web-frontend, backend-api,
  security-pentest, devops, code-review, ai-ml, specialized-creative) → just delegate to that
  native subagent by name and stop here.
- **A domain-vertical team fits better** (aerospace, agtech, fintech, medtech, gamedev, …) →
  **read that team file and adopt its persona inline** for the task. Do not try to spawn it as
  a subagent; it is deliberately not registered as one.
- **Nothing fits** → handle it yourself as the generalist. Never invent a team name.

Name the team you picked in one line before you start, so the user can see the routing.

## 2. Skills

Match the task against installed skills the same way (`ls ~/.claude/skills/`) and invoke the
ones that genuinely apply. Prefer a real skill over improvising its content. Do not stack
skills on a task that does not need them — an obvious one-line change needs no ceremony.

## 3. Verify before you claim (the part that makes it a Council, not just a router)

Before reporting anything as done, working, or fixed:

- **Fact-check.** Every external tool/API/flag/package claim must trace to something you
  actually read or ran in this session. If it cannot be verified, say so explicitly instead
  of asserting it.
- **Anti-hallucination.** "I fixed it" without running the relevant check is not a result —
  it is a guess. Run the project's own check (`./verify.sh`, its tests, a real build) and
  report what it actually printed.
- **Anti-loop.** If an approach already failed in this session, it is blocked — do not retry
  it in a new costume. Pivot, and say what you are pivoting from and why.

## 4. Record it (PulsarIDE)

The Council's routing decisions and verdicts belong on the board, not just in chat. When the
project is tracked, use the `planide` MCP tools in the same turn the fact appears: `add_item`
for work you plan, `set_item` when it moves, `add_fix` / `mark_fixed` for bugs. Pass
`project` = the project's absolute path. This works identically in Claude Code, Codex,
Antigravity and Gemini CLI — all four have the `planide` server registered.

## Activation signal

When you act as the Council, the first line of that response must be exactly:

`🔴 ThePunisher — The Council`
