#!/usr/bin/env bash
# ThePunisher :: install the Binary Ninja headless MCP bridge (Linux/macOS) — Team 5
#
# Installs mrphrazer/binary-ninja-headless-mcp (GPL-2.0, verified live: 213 stars at last
# check) — a pure-Python MCP server that lets an agent drive Binary Ninja's headless API.
# Not on PyPI; installed straight from a pinned commit so re-running this script is
# reproducible instead of silently picking up whatever is on `main` that day.
#
# IMPORTANT, read before running: this script installs the *bridge* only. Binary Ninja
# itself is COMMERCIAL software (a paid, per-seat license, with a headless-capable tier
# required for real analysis) -- this repo cannot install or provide that license for you.
# If you don't already have Binary Ninja + a headless license, the bridge still installs
# and runs fine in `--fake-backend` mode (upstream's own CI/dev mode), but it cannot
# analyze real binaries until you separately own a real Binary Ninja install. Ghidra
# (free, NSA open-source; see install-ghidra.sh) is ThePunisher's default disassembler
# for exactly this reason -- reach for this bridge only if you already have Binary Ninja.
#
# Usage:
#   ./install-binja-mcp.sh              # install the bridge
#   ./install-binja-mcp.sh -Verify      # only verify an existing install
set -euo pipefail

REPO="mrphrazer/binary-ninja-headless-mcp"
# Pinned to a known-good commit (verified live against the real repo) rather than `main`,
# so installs are reproducible. Override with BINJA_MCP_REF if you want a different ref.
PIN="${BINJA_MCP_REF:-49c39c2d4427b586ce1ec3499baa86c38f980ece}"
VERIFY_ONLY=0
case "${1:-}" in
    -Verify|--verify) VERIFY_ONLY=1 ;;
esac

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  OK\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m  FAIL\033[0m %s\n' "$*" >&2; exit 1; }

find_console_script() {
    for name in binary_ninja_headless_mcp binary-ninja-headless-mcp; do
        command -v "$name" >/dev/null 2>&1 && { echo "$name"; return 0; }
    done
    return 1
}

check_binaryninja_module() {
    if python3 -c "import binaryninja" >/dev/null 2>&1; then
        ok "binaryninja Python module importable — a real, licensed Binary Ninja install was found"
        return 0
    fi
    warn "binaryninja Python module not importable — no real Binary Ninja install detected"
    warn "the bridge will still install and run, but only in --fake-backend mode until you"
    warn "install Binary Ninja yourself (commercial license required, this repo can't provide it)"
    return 1
}

do_verify() {
    local script
    script="$(find_console_script)" || die "binary-ninja-headless-mcp bridge not installed (run without -Verify)"
    ok "bridge installed: $(command -v "$script")"
    "$script" --help >/dev/null 2>&1 || die "bridge installed but --help failed to run"
    ok "bridge responds to --help"
    check_binaryninja_module || true
    exit 0
}
[ "$VERIFY_ONLY" -eq 1 ] && do_verify

command -v python3 >/dev/null 2>&1 || die "python3 is required"
PYVER="$(python3 -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])')"
[ "$PYVER" -ge 311 ] || die "python3.11+ required (found $(python3 --version 2>&1)) — upstream's own minimum"
command -v pip3 >/dev/null 2>&1 || die "pip3 is required"

info "Installing binary-ninja-headless-mcp bridge (pinned to $PIN)..."
pip3 install --user "git+https://github.com/${REPO}.git@${PIN}" ||
    die "pip install failed — check network access and that git is on PATH"

SCRIPT="$(find_console_script)" || die "installed, but no binary_ninja_headless_mcp console script found on PATH (check your pip --user bin dir, e.g. ~/.local/bin, is on PATH)"
ok "bridge installed -> $(command -v "$SCRIPT")"

info "Verifying it responds..."
"$SCRIPT" --help >/dev/null 2>&1 || die "installed but --help failed to run"
ok "bridge responds to --help"

check_binaryninja_module || true

echo
echo "MCP client config (see ../mcp/mcp-re-tools.json for the full entry):"
echo "  command: $SCRIPT"
echo "  args:    []                    # stdio transport (default)"
echo "  args:    [\"--fake-backend\"]     # no real Binary Ninja install? test with this"
echo
echo "Merge it in: ../install.sh --with-re-mcp   (or copy the 'binary-ninja' block from"
echo "mcp-re-tools.json into your mcp.json by hand)"
