#!/usr/bin/env bash
# Pulse Agent :: cross-platform static RE triage driver (Linux/macOS)
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

# Load GHIDRA_HOME ourselves.
#
# install-ghidra.sh writes this env file, and it used to rely on a shell hook
# sourcing it from .bashrc/.zshrc. PulsarIDE installs no such hook, so nothing
# ever sourced it: GHIDRA_HOME stayed unset, this script silently fell through
# to radare2/objdump, and the best analyser we ship was never actually used.
# Sourcing it here needs no shell integration at all and works the same whether
# an agent or a person runs it. The old path is read too, so a machine that
# installed Ghidra before this still works.
for _env in "$HOME/.config/pulsaride/ghidra.env" "$HOME/.config/thepunisher/ghidra.env"; do
    if [ -z "${GHIDRA_HOME:-}" ] && [ -r "$_env" ]; then
        # shellcheck disable=SC1090
        . "$_env"
    fi
done

echo "==> Pulse RE triage: $BIN"
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
