#!/usr/bin/env bash
# ThePunisher :: graphify SessionStart bootstrap hook (Claude Code).
#
# Converts the "personas should auto-run graphify" instruction (GLOBAL_RULES / CLAUDE.md)
# from a prompt-level request into something code actually enforces. Direct response to a
# real user: "graphify doet niets, ik zie niets gebeuren" (graphify does nothing, I see
# nothing happening) -- the instruction is present in every deployed persona file, but
# whether it actually ran depended entirely on the model remembering to run it, which
# CLAUDE.md's own "prompt-level instruction, not something code can force" caveat already
# admitted it could not guarantee. Wired as a Claude Code SessionStart hook (verified
# against code.claude.com/docs/en/hooks.md: command-type SessionStart hooks fire once per
# session/resume/clear, run BEFORE the model sees the first prompt, and stdout/
# additionalContext is injected into the model's own context) -- this makes the FIRST
# extraction happen automatically, with zero dependency on the model choosing to run it.
#
# Reads the hook's JSON payload from stdin (SessionStart's payload carries
# {"cwd": ..., "source": ..., ...} per the docs) to find the real project directory --
# not $PWD, since a hook's own working directory is not guaranteed to match the session's.
set -euo pipefail

command -v python3 >/dev/null 2>&1 || exit 0

PAYLOAD="$(cat)"
CWD="$(printf '%s' "$PAYLOAD" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("cwd") or "")
except Exception:
    print("")
' 2>/dev/null || true)"
[ -n "$CWD" ] || CWD="$PWD"
cd "$CWD" 2>/dev/null || exit 0

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MEMORY_SCRIPT="$SCRIPT_DIR/council-memory.py"
[ -f "$MEMORY_SCRIPT" ] || exit 0

# One bounded cross-platform pipeline now owns Data receipts, Graphify extraction/global
# registration, and the managed Obsidian note. It never guesses savings or activity.
RESULT="$(timeout 40s python3 "$MEMORY_SCRIPT" --project "$CWD" --team "The Council" --event "session-start" 2>/dev/null || true)"
CTX=""
if [ -n "$RESULT" ]; then
    CTX="$(printf '%s' "$RESULT" | python3 -c '
import json, sys
try:
    d=json.load(sys.stdin)
    print("Council memory synced for %s v%s (Graphify: %s; Obsidian: %s)." % (
        d.get("project_name","project"), d.get("version","unknown"),
        d.get("graphify",{}).get("status","unknown"),
        d.get("obsidian",{}).get("status","unknown")))
except Exception:
    print("Council memory sync completed.")
' 2>/dev/null || echo "Council memory sync completed.")"
fi

# If PulsarIDE already tracks this project, tell the session to use the board.
# Gated on the state file existing -- exactly the guard agent-events.ts uses --
# so a session in an untracked repo is never nudged and no repo is littered.
if [ -f "$CWD/.planide/state.json" ]; then
    NOTE="This project is tracked by PulsarIDE's built-in board (.planide/state.json), shown live in the IDE Tracker tab. Keep it in sync with this chat automatically, without being asked: read it first with the planide MCP tool get_board (or: plan board \"$CWD\"); when you get something working set_item status=works, when you find or hit a bug add_fix or set_item status=broken, when the user says something is solved mark_fixed it and set the item to works, and BEFORE you say 'done' or 'please test' update the board so it matches what you claim. Use the planide MCP tools (add_item, set_item [todo|wip|works|broken|blocked], add_fix, mark_fixed, add_version) or the plan CLI, passing project=\"$CWD\". Report only what is real -- mark works only when it works; the verified/locked flags stay the user's."
    if [ -n "$CTX" ]; then CTX="$CTX $NOTE"; else CTX="$NOTE"; fi
fi

if [ -n "$CTX" ]; then
    python3 -c '
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.argv[1]}}))
' "$CTX"
fi
exit 0
