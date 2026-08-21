# AI-driven editing for GPL-engine games (Rakion / Wolfteam) — real architecture, not a claim

Direct response to wanting "eigen tooling om game volledig via ai te editen" (own tooling to
edit the game fully via AI) for Rakion (Croteam's Serious Engine, GPL-2.0) and Wolfteam
(LithTech, GPL-licensed via the Jupiter EX source release), plus an option to convert either
to Unreal Engine. Both engine identifications were verified against real sources before any of
this was written (see `integrations/repos.json`'s `Croteam-official/Serious-Engine` and the
three LithTech entries) — this doc is honest about what's buildable today versus what needs a
separate, dedicated effort, rather than claiming a finished pipeline that doesn't exist.

## There is no existing "AI-edit this engine" tool to wire in

A GitHub search for Serious-Engine-specific or LithTech-specific MCP/AI-editing bridges found
nothing — unlike Ghidra, Binary Ninja, x64dbg, and Unreal Engine (all of which have real,
maintained MCP servers this repo already catalogs), no one has built this for either engine.
`flopperam/unreal-engine-mcp` (now cataloged in `mcp/mcp-re-tools.json`) controls a **genuinely
Unreal-native** project via natural language — it does not, and cannot, convert a Serious
Engine or LithTech game INTO Unreal Engine by itself. `kevinpbuckley/VibeUE` (also cataloged in
`mcp/mcp-re-tools.json`, complementing rather than replacing flopperam's server) expands the
same idea further for a genuinely UE-native target — deeper landscape/terrain, audio, Niagara
FX, animation, and Blueprint tooling, plus real CPU/GPU performance profiling — but has the
identical fundamental limit: it drives an Unreal project that is already Unreal, not a
foreign engine's assets converted into one. Converting one engine's assets, level
data, and gameplay logic into another engine is a substantial reverse-engineering plus
re-implementation project on its own, regardless of AI tooling.

## The real, buildable architecture (three layers, depending on what you have)

**1. Source-level editing** — if you have (or build, via `jsj2008/lithtech` /
`Croteam-official/Serious-Engine`) the actual engine source plus the target game's own asset
and level data: this is just code editing. ThePunisher's Elite Coding team (Team 4,
`ThePunisher-CppExpert` specifically) already handles C/C++ engine code with no new tooling
needed — the value-add here is Team 5's RE agents helping map how a SPECIFIC game (Rakion
v258, Wolfteam) diverges from the stock open-sourced engine, since licensees historically
modify the base engine per-title.

**2. Live console/scripting injection into a running compiled game** — the realistic path for
"AI edits the game while it's running," and the same pattern `x64dbg_mcp` already uses in this
repo's own `mcp-re-tools.json`: attach to the live process, drive whatever console/scripting
interface the engine already exposes (Serious Engine has a real in-game console + its own
scripting; LithTech titles commonly expose similar dev-console commands), and wrap that as an
MCP server so an agent can issue commands through it instead of a human typing them. This is
buildable, but needs: (a) the actual compiled game binary running on a real Windows machine —
this repo's own Linux sandbox cannot build or run either engine to develop and test against,
so this cannot be built and verified from here without that binary; (b) reverse-engineering the
SPECIFIC console/scripting surface the target game version actually ships (not just the stock
open-sourced engine's — see the version-naming caution already built into `council-memory.py`'s
`version_slug()`, since a licensee's build can differ meaningfully from the public GPL release).

**3. Static binary RE** — for anything not covered by source or a live console (packed/obfuscated
sections, anti-cheat, protocol-level client-server behavior): already fully covered by Team 5's
existing toolchain — Ghidra headless triage (`re-triage.sh`), the Ghidra MCP bridge, x64dbg for
live Windows debugging, `ThePunisher-ProtocolRE` for capturing and reverse-engineering the actual
network protocol (directly relevant to Wolfteam/Rakion's own client-server traffic), and
`ThePunisher-BinDiffExpert` for diffing across game client versions.

## What this repo has NOT built, and why

An actual `serious-engine-mcp` or `lithtech-mcp` bridge (layer 2 above) is not shipped in this
pass. Building one that's real (not a stub that looks plausible but was never run against an
actual game) needs a compiled, runnable copy of the specific target game — Rakion server+client
or Wolfteam — which this repo's own Linux-only development sandbox cannot provide, build, or
test against. If you can supply that (a working build, or access to a running instance), the
next concrete step is standing up layer 2 for that specific binary: RE its console/scripting
surface with the existing Ghidra/x64dbg tooling above, then wrap the discovered commands as an
MCP server following the same shape as `x64dbg_mcp`/`unreal-engine-mcp` already cataloged here.
