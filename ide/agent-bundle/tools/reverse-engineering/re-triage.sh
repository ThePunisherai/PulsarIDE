#!/usr/bin/env bash
# ThePunisher :: cross-platform static RE triage driver (Linux/macOS)
# Picks the best available tool and produces a compact triage of a binary:
#   Ghidra headless (best)  >  radare2  >  objdump + strings (always-available fallback)
#
# Usage: ./re-triage.sh /path/to/binary
set -euo pipefail

BIN="${1:-}"
if [ -z "$BIN" ] || [ ! -f "$BIN" ]; then
    echo "usage: $0 <binary>" >&2
    exit 2
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> ThePunisher RE triage: $BIN"
if command -v file >/dev/null 2>&1; then
    echo "--- file ---"; file "$BIN"
fi

if command -v analyzeHeadless >/dev/null 2>&1 || [ -n "${GHIDRA_HOME:-}" ]; then
    echo "--- Ghidra headless ---"
    HEADLESS="$(command -v analyzeHeadless || echo "$GHIDRA_HOME/support/analyzeHeadless")"
    proj="$(mktemp -d)"
    "$HEADLESS" "$proj" Triage \
        -import "$BIN" \
        -postScript ghidra_triage.py \
        -scriptPath "$HERE/scripts" \
        -deleteProject 2>/dev/null || echo "  (Ghidra run failed; see output above)"
    rm -rf "$proj"
elif command -v r2 >/dev/null 2>&1; then
    echo "--- radare2 ---"
    r2 -A -q \
        -c 'iI; echo === imports ===; ii~...; echo === functions ===; afl~[0,3]; echo === strings ===; izq~...' \
        "$BIN" 2>/dev/null || echo "  (r2 run failed)"
else
    echo "--- fallback: objdump + strings ---"
    command -v objdump >/dev/null 2>&1 && { echo "[headers]"; objdump -f "$BIN" 2>/dev/null || true; }
    # `strings | head` gets SIGPIPE when head closes early; swallow it so pipefail
    # doesn't abort the script before the summary line.
    command -v strings >/dev/null 2>&1 && { echo "[strings (first 60)]"; strings -a "$BIN" | head -60 || true; }
fi

echo "==> triage complete"
