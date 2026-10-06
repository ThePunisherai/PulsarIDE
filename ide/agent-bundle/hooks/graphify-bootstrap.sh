#!/usr/bin/env bash
# Pulse Agent :: graphify SessionStart bootstrap hook (Claude Code).
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
# Never a "hook error": whatever happens in main, the session starts -- exit 0,
# and what went wrong is appended to hook-errors.log beside this script, the log
# every other PulsarIDE hook uses. `set -e` is deliberately not used: one failed
# lookup must cost a line of context, not the hook.
#
# Fast by design. This hook used to run the whole Council memory sync itself,
# Graphify extraction included, inside the agent's hook budget (Claude Code: 30 s);
# on a project whose graph took longer the agent stopped it and reported a
# SessionStart hook error at every session start. council-memory.py's `hook`
# command now answers from the last sync at once and refreshes in the background.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd)"
LOG="${SCRIPT_DIR:-.}/hook-errors.log"

main() {
    # Read the payload first: an agent writing to a pipe nobody reads sees a broken pipe.
    local PAYLOAD CWD MEMORY_SCRIPT RESULT CTX NOTE PY
    PAYLOAD="$(cat)"
    PY="$(command -v python3 2>/dev/null || true)"
    CWD=""
    if [ -n "$PY" ]; then
        CWD="$(printf '%s' "$PAYLOAD" | "$PY" -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("cwd") or "")
except Exception:
    print("")
' 2>/dev/null || true)"
    fi
    [ -n "$CWD" ] || CWD="$PWD"
    cd "$CWD" 2>/dev/null || return 0

    CTX=""
    MEMORY_SCRIPT="$SCRIPT_DIR/council-memory.py"
    if [ -n "$PY" ] && [ -f "$MEMORY_SCRIPT" ]; then
        # council-memory.py writes its own errors to hook-errors.log.
        RESULT="$("$PY" "$MEMORY_SCRIPT" hook --project "$CWD" --team "The Council" --event "session-start" 2>/dev/null || true)"
        if [ -n "$RESULT" ]; then
            CTX="$(printf '%s' "$RESULT" | "$PY" -c '
import json, sys
try:
    d = json.loads(sys.stdin.read().strip().splitlines()[-1])
    if d.get("never_synced"):
        print("Council memory for %s is being built in the background (Graphify + Obsidian)." % d.get("project_name", "project"))
    else:
        print("Council memory for %s v%s (Graphify: %s; Obsidian: %s%s)." % (
            d.get("project_name", "project"), d.get("version", "unknown"),
            (d.get("graphify") or {}).get("status", "unknown"),
            (d.get("obsidian") or {}).get("status", "unknown"),
            ", refreshing in the background" if d.get("refreshing") else ""))
except Exception:
    pass
' 2>/dev/null || true)"
        fi
    fi

    # If PulsarIDE already tracks this project, tell the session to use the board.
    # Gated on the state file existing -- exactly the guard agent-events.ts uses --
    # so a session in an untracked repo is never nudged and no repo is littered.
    if [ -f "$CWD/.planide/state.json" ]; then
        NOTE="This project is tracked by PulsarIDE's board (.planide/state.json, the IDE Tracker tab). Keep it current without being asked, as your PulsarIDE instructions say: get_board or next_task first (finish wip, then todo, then open fixes), add_item/set_item as the work moves, add_fix for a bug you hit, and update the board before you say done. Pass project=\"$CWD\" (CLI fallback: plan board \"$CWD\")."
        if [ -n "$CTX" ]; then CTX="$CTX $NOTE"; else CTX="$NOTE"; fi
    fi

    [ -n "$CTX" ] || return 0
    if [ -n "$PY" ]; then
        "$PY" -c '
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.argv[1]}}))
' "$CTX"
    fi
}

main 2> >(while IFS= read -r line; do printf '[graphify-bootstrap] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$line"; done >>"$LOG" 2>/dev/null) || true
exit 0
