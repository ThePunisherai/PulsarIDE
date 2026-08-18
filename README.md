<div align="center">

<img src="static/icon.svg" width="96" alt="PlanIDE" />

# PlanIDE

**Your projects, tracked — from "what works / what's broken" to shipped.**

A local **project command deck**: pick any project folder (web app, `.exe`,
emulator, library — anything), track what works and what's broken, log
AI-assisted fixes, keep a roadmap and version history, snapshot backups,
auto-detect the language/stack, and sync to GitHub (large files included).

_Zero dependencies — one Python file, no build step._

</div>

---

## Why

Two open-source tools inspired this, and PlanIDE is the **mix** of the halves
that matter for solo/AI-assisted building:

| Tool | What it does | What PlanIDE borrows |
|------|--------------|----------------------|
| [oblien/openship](https://github.com/oblien/openship) | Self-hosted build/ship/deploy platform with GitHub push-to-deploy, backups, multi-language support | Auto-detect stack, **GitHub sync + large files**, **backups**, version tracking |
| [stablyai/orca](https://github.com/stablyai/orca) | AI-agent orchestration IDE — run agents in parallel, feed diffs back, track work | **AI-agent coupling**: export a structured briefing of what's broken → hand to Claude/Codex → log the fix back |

Where those are heavyweight (a deploy platform; an Electron IDE), PlanIDE is a
**single Python file you run next to your code**. It doesn't replace your
editor or your agents — it's the tracker/PM brain that sits beside them.

## What it does

- **📁 Any project, any type.** Point it at a folder. It auto-detects the
  language & stack (Node/Python/Rust/Go/C++/C#/.NET/PHP/Ruby/Flutter/…) and
  guesses the *type*: web, desktop-exe, **emulator**, game, mobile, library,
  cli, data — or `custom`, which you can override.
- **✅ Works / broken tracker board.** A kanban of items with statuses:
  `works · in progress · broken · blocked · to do`. This is your live
  "what works, what doesn't."
- **🔧 Fix log (AI or manual).** Every fix is *problem → solution*, optionally
  tagged with the agent that did it (Claude, Codex, you). This is the
  "tracking via AI agents" layer.
- **✦ AI export.** One click turns the whole board into a structured Markdown
  briefing — *what works, what's broken, open fixes, recently fixed, roadmap,
  version history* — ending with a concrete **Ask**. Paste it into any agent.
- **🗺️ Roadmap.** Milestones with a live progress bar — how far along you are.
- **🏷️ Versions.** A changelog per version (added / fixed / changed).
- **⾕ GitHub sync.** Init a repo, set the remote, **scan for large files** and
  track them with Git LFS, then commit & push (with retry). Uses your existing
  git credentials — PlanIDE never stores a token.
- **💾 Backups.** One-click zip snapshots (skips `node_modules`/`.git`/etc.),
  list & restore.

## Quickstart

```bash
git clone https://github.com/ThePunisherai/PlanIDE.git
cd PlanIDE
./start.sh                 # -> http://127.0.0.1:8390  (or: python3 server.py)
```

Open the URL, click **Add project**, browse to a folder — done. Everything is
Python standard library; there is nothing to install.

### From the terminal (scriptable, agent-friendly)

```bash
./plan add ~/code/my-emulator          # register + auto-detect
./plan list                            # all projects + progress
./plan detect ~/code/my-emulator       # just the stack detection
./plan report ~/code/my-emulator       # print the AI briefing (pipe to an agent)
./plan backup ~/code/my-emulator       # zip snapshot
./plan sync   ~/code/my-emulator -m "wip"   # git add/commit/push
```

`./plan report … | claude -p "fix the broken items"` is the whole
agent loop in one line.

## Where your data lives

- **Central registry** — `~/.config/planide/projects.json` (which folders you
  added).
- **Per-project state** — `<project>/.planide/state.json` (items, fixes,
  roadmap, versions, github + backup metadata). It lives *inside the project*
  so it travels with your code and can be committed.

## Coupling to AI agents & IDEs

PlanIDE is a localhost web app + a JSON API + a CLI, so it plugs into whatever
you already use:

- **Any agent (Claude, Codex, …)** — use **AI export** (or `plan report`) to
  hand the agent an accurate, structured picture of what's broken and what it
  should do. Log the result back as a fix (with the agent's name).
- **Orca / any IDE with a built-in browser** — run PlanIDE and open
  `http://127.0.0.1:8390` as a panel beside your agents; the agents do the
  work, PlanIDE tracks it.
- **Same family as ThePunisher / Agentic OS** — matching navy/red palette and
  the same "run one Python file" philosophy, so it drops into that workflow.

## Verify

```bash
./scripts/verify.sh        # compiles, boots the server, exercises the API + CLI
                           # end-to-end, checks CSRF. Prints ALL GREEN.
```

## Security

A local tool: it binds to `127.0.0.1` only. State-changing `POST`s are refused
when they carry a cross-origin browser `Origin` header (CSRF protection), so no
other browser tab can drive it. It shells out to your real `git`; it never
stores credentials.

## License

[Apache-2.0](LICENSE) — same spirit as the tools that inspired it.
