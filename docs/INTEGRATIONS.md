# Integrations, and what was deliberately left out

Every repository that has been evaluated for PulsarIDE, what was done with it,
and why. The "why not" entries matter as much as the rest: three of the ways
this project has broken were bundling something that should have been fetched,
or fetching something that should have been indexed.

## In the app

| Repository | License | How it ships |
|---|---|---|
| [stablyai/orca](https://github.com/stablyai/orca) | MIT | The IDE itself, as an anchored overlay on a pinned commit. |
| [tt-a1i/archify](https://github.com/tt-a1i/archify) | MIT | Vendored skill (2.16.0). `deliver --quality showcase`, `compare` for Before/Delta/After, guided views, cards. |
| [MengTo/threeui](https://github.com/MengTo/threeui) | MIT | 44 components vendored, plus upstream's own descriptions as `catalog.json` — searched with `ui_find`. |
| [mblode/agent-skills](https://github.com/mblode/agent-skills) | MIT | 25 of the 77 bundled skills. |
| [obra/superpowers](https://github.com/obra/superpowers) | MIT | Already present: `systematic-debugging`, `writing-plans`, `brainstorming` and `ui-verification` came in with the vendored skill libraries. Not vendored a second time. |

## Fetched, not bundled

| Repository | License | Why not bundled |
|---|---|---|
| [affaan-m/ECC](https://github.com/affaan-m/ECC) | MIT | 354 skills and agents. Installed as a plugin it costs ~40,600 always-on tokens per session. The catalogue is cloned to disk and searched with `ecc_find` / `ecc_read` instead, at zero cost. Their README also asks people not to run unofficial mirrors. |
| [meshy-dev/meshy-mcp-server](https://github.com/meshy-dev/meshy-mcp-server) | see repo | A paid API. Registered for every agent the moment a key is saved in the Archify tab, removed again when it is cleared — without a key its server exits and every agent would show a broken tool. |

## Catalogued only

| Repository | What it is | Why it is not wired in |
|---|---|---|
| [Mood-Global-Services/How-to-Clone-Website](https://github.com/Mood-Global-Services/How-to-Clone-Website---Claude-Skills) | MIT | Not a skill: a Next.js + shadcn project template you clone and point at a URL, with its own `CLAUDE.md` and `TARGET.md`. Bundling a scaffold into the installer would be the ECC mistake again. The Council names it when the task is cloning a site's design. |
| [Tencent/teamai-cli](https://github.com/Tencent/teamai-cli) | A CLI for making a team AI-native | Its own tool with its own workflow. Nothing here would call it. |
| [rohitg00/ai-engineering-from-scratch](https://github.com/rohitg00/ai-engineering-from-scratch) | A reference manual | Reading material, not a capability. |

## The rule this table encodes

Bundle what is small and always needed. Fetch and index what is large and
occasionally needed. Catalogue what is someone else's tool. Getting this wrong
is what put 40,600 tokens into every session once, and 63 MB of someone else's
plugin into an installer that Windows Defender then flagged.
