#!/usr/bin/env bash
# ThePunisher :: install Ghidra headless (Linux/macOS) — Team 5 Reverse Engineering Command
#
# Downloads the latest official Ghidra release from NationalSecurityAgency/ghidra (Apache-2.0,
# NSA open-source), verifies its published SHA-256 digest, extracts it, and writes
# ~/.config/thepunisher/ghidra.env (GHIDRA_HOME + PATH) so `analyzeHeadless` — the tool
# re-triage.sh and scripts/ghidra_triage.py already drive — works with zero manual setup in any
# new shell. re-triage.sh sources this file directly, so no shell integration is
# needed. Fully headless: this script never opens a GUI, and neither does
# analyzeHeadless itself.
#
# Requires a JDK 21 (64-bit) on PATH or JAVA_HOME -- verified against Ghidra's own
# GhidraDocs/GettingStarted.md. This script checks for one and tells you where to get a free
# one (Adoptium Temurin / Amazon Corretto) if it's missing; it does not install a JDK for you
# (that's a bigger, more invasive system change than this repo makes by default).
#
# Usage:
#   ./install-ghidra.sh              # install latest release
#   ./install-ghidra.sh -Verify      # only verify an existing install
#   GHIDRA_INSTALL_DIR=/opt/ghidra ./install-ghidra.sh   # custom location
set -euo pipefail

REPO="NationalSecurityAgency/ghidra"
INSTALL_DIR="${GHIDRA_INSTALL_DIR:-$HOME/.config/thepunisher/ghidra}"
STATE_DIR="$HOME/.config/pulsaride"
ENV_FILE="$STATE_DIR/ghidra.env"
VERIFY_ONLY=0
case "${1:-}" in
    -Verify|--verify) VERIFY_ONLY=1 ;;
esac

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  OK\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m  FAIL\033[0m %s\n' "$*" >&2; exit 1; }

check_java() {
    if ! command -v java >/dev/null 2>&1; then
        warn "no 'java' on PATH — Ghidra needs a JDK 21 (64-bit) runtime+dev kit."
        warn "Free LTS builds: https://adoptium.net (Temurin) or https://aws.amazon.com/corretto"
        return 1
    fi
    # `java -version` output order isn't guaranteed to put the version line first --
    # some environments print a JAVA_TOOL_OPTIONS/diagnostic line before it (confirmed
    # live) -- so grep the whole output for the version pattern, THEN take the first
    # match, rather than head -1'ing before searching.
    local ver
    ver="$(java -version 2>&1 | grep -oE '"[0-9]+' | tr -d '"' | head -1)"
    ver="${ver:-0}"
    if [ "${ver:-0}" -lt 21 ]; then
        warn "java on PATH reports version $ver; Ghidra requires JDK 21+. Install a newer JDK"
        warn "(https://adoptium.net or https://aws.amazon.com/corretto) and re-run."
        return 1
    fi
    ok "java $ver found on PATH"
    return 0
}

find_ghidra_home() {
    # The extracted zip's top-level dir is named ghidra_<version>_PUBLIC.
    find "$INSTALL_DIR" -maxdepth 1 -type d -name 'ghidra_*_PUBLIC' 2>/dev/null | sort | tail -1
}

do_verify() {
    local home; home="$(find_ghidra_home)"
    [ -n "$home" ] && [ -x "$home/support/analyzeHeadless" ] || die "no working Ghidra install found under $INSTALL_DIR"
    "$home/support/analyzeHeadless" 2>&1 | grep -qi "analyzeHeadless" || die "analyzeHeadless didn't respond as expected"
    ok "Ghidra verified: $home"
    check_java || true
    exit 0
}
[ "$VERIFY_ONLY" -eq 1 ] && do_verify

info "Installing Ghidra headless -> $INSTALL_DIR"
check_java || warn "continuing anyway — analyzeHeadless will just fail until a JDK 21 is on PATH"

command -v curl >/dev/null 2>&1 || die "curl is required"

info "Resolving latest release from $REPO..."
API_JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" ||
    die "could not reach GitHub API (rate-limited or offline)"

ASSET_URL="$(printf '%s' "$API_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for a in d["assets"]:
    if a["name"].endswith(".zip"):
        print(a["browser_download_url"]); print(a.get("digest",""))
        break
')"
ASSET_URL_LINE="$(printf '%s\n' "$ASSET_URL" | sed -n 1p)"
ASSET_DIGEST="$(printf '%s\n' "$ASSET_URL" | sed -n 2p)"
[ -n "$ASSET_URL_LINE" ] || die "no .zip asset found in latest release — check https://github.com/$REPO/releases"
TAG="$(printf '%s' "$API_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
info "Latest: $TAG ($(basename "$ASSET_URL_LINE"))"

mkdir -p "$INSTALL_DIR"
TMP_ZIP="$(mktemp -t ghidra-XXXXXX.zip)"
trap 'rm -f "$TMP_ZIP"' EXIT

info "Downloading..."
curl -fL --progress-bar -o "$TMP_ZIP" "$ASSET_URL_LINE"

if [ -n "$ASSET_DIGEST" ]; then
    info "Verifying published digest ($ASSET_DIGEST)..."
    ALGO="${ASSET_DIGEST%%:*}"
    WANT="${ASSET_DIGEST#*:}"
    if command -v "${ALGO}sum" >/dev/null 2>&1; then
        GOT="$("${ALGO}sum" "$TMP_ZIP" | awk '{print $1}')"
        [ "$GOT" = "$WANT" ] || die "digest mismatch! got $GOT, expected $WANT — download corrupted or tampered, aborting"
        ok "digest verified ($ALGO)"
    else
        warn "no ${ALGO}sum tool available to verify the digest — skipping (asset URL was HTTPS from api.github.com, at least TLS-authenticated)"
    fi
else
    warn "release did not publish a digest for this asset — skipping verification"
fi

info "Extracting..."
command -v unzip >/dev/null 2>&1 || die "unzip is required"
unzip -q -o "$TMP_ZIP" -d "$INSTALL_DIR"

GHIDRA_HOME="$(find_ghidra_home)"
[ -n "$GHIDRA_HOME" ] || die "extracted, but couldn't find ghidra_*_PUBLIC under $INSTALL_DIR"
chmod +x "$GHIDRA_HOME"/support/analyzeHeadless "$GHIDRA_HOME"/ghidraRun 2>/dev/null || true

mkdir -p "$STATE_DIR"
cat > "$ENV_FILE" <<EOF
# Pulse Agent: written by tools/reverse-engineering/install-ghidra.sh, and read
# directly by re-triage.sh -- do not hand-edit, re-run the installer instead.
# Source it yourself if you want GHIDRA_HOME in your own shell.
export GHIDRA_HOME="$GHIDRA_HOME"
export PATH="\$GHIDRA_HOME/support:\$PATH"
EOF
ok "wrote $ENV_FILE"

# Make it available in *this* shell/session immediately too, not just future ones.
export GHIDRA_HOME
export PATH="$GHIDRA_HOME/support:$PATH"

info "Verifying analyzeHeadless responds..."
"$GHIDRA_HOME/support/analyzeHeadless" 2>&1 | grep -qi "analyzeHeadless" ||
    die "installed but analyzeHeadless didn't respond as expected"

ok "Ghidra $TAG installed headless -> $GHIDRA_HOME"
echo
echo "re-triage.sh picks this up automatically. For your own shell:"
echo "  source $ENV_FILE"
echo "Then:"
echo "  ./re-triage.sh /path/to/binary     # auto-uses Ghidra headless, no GUI, no manual setup"
