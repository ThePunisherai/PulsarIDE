#!/usr/bin/env bash
# ThePunisher :: AFL++ fuzzing driver (Linux)
#
# Wires together the real, upstream AFL++ toolchain (AFLplusplus/AFLplusplus, GPL-2.0 core +
# Apache-2.0 mutators — the maintained community successor to the original AFL) the same way
# re-triage.sh wires together Ghidra/r2/objdump: a thin, honest driver over tools you install
# yourself, never a reimplementation. Two real, documented AFL++ modes, verified live in this
# repo's own dev sandbox (Debian/Ubuntu `afl++` package, not guessed from docs alone):
#   1. --build: compile source with afl-cc (instrumented) and fuzz the result — the fast path,
#      requires source.
#   2. --qemu (-Q): AFL++'s binary-only QEMU mode for a target with NO source (a stripped/
#      packaged binary handed off by Team 5's own unpacking pipeline, see linux-unpack.sh in
#      this same directory) — requires AFL++'s separate QEMU build step, see the check below.
#
# Usage:
#   ./fuzz-driver.sh --build target.c [more.c ...] -- <target-args, use @@ for the input file>
#   ./fuzz-driver.sh --bin ./already-instrumented-binary -- <target-args>
#   ./fuzz-driver.sh --qemu --bin ./stripped-binary -- <target-args>
#
# Options:
#   -i DIR     seed corpus directory (default: ./fuzz-in — auto-scaffolded with one placeholder
#              seed if it doesn't exist or is empty; AFL++ refuses to start with zero seeds)
#   -o DIR     AFL++ output directory (default: ./fuzz-out)
#   -t MS      per-run timeout in ms, passed straight to afl-fuzz -t (default: AFL++'s own
#              auto-scaled default)
#   -V SECS    stop after this many seconds (afl-fuzz -V) — the right default for a driven/CI
#              run; omit for an interactive open-ended session
#   -h         this help
#
# Ethics: authorized security research, CTF, and interoperability testing only — the same
# guardrail as the rest of this directory (see x64dbg-setup.md's "Ethics & scope").
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '3,26p' "$HERE/fuzz-driver.sh" | sed 's/^# \{0,1\}//'; }

MODE=""            # build | bin
QEMU=0
BUILD_SRCS=()
BIN=""
IN_DIR="fuzz-in"
OUT_DIR="fuzz-out"
TIMEOUT_MS=""
DURATION_S=""
TARGET_ARGS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --build)
            MODE="build"; shift
            while [ $# -gt 0 ] && [ "$1" != "--" ] && [ "$1" != "-o" ] && [ "$1" != "-i" ] \
                  && [ "$1" != "-t" ] && [ "$1" != "-V" ] && [ "$1" != "--qemu" ] && [ "$1" != "-Q" ]; do
                BUILD_SRCS+=("$1"); shift
            done
            ;;
        --bin) MODE="bin"; BIN="${2:-}"; shift 2 ;;
        --qemu|-Q) QEMU=1; shift ;;
        -i) IN_DIR="${2:-}"; shift 2 ;;
        -o) OUT_DIR="${2:-}"; shift 2 ;;
        -t) TIMEOUT_MS="${2:-}"; shift 2 ;;
        -V) DURATION_S="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        --) shift; TARGET_ARGS=("$@"); break ;;
        *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
    esac
done

if [ -z "$MODE" ]; then
    echo "error: need --build <src...> or --bin <path>" >&2
    usage; exit 2
fi

# ---------------------------------------------------------------- build mode
if [ "$MODE" = "build" ]; then
    if [ "${#BUILD_SRCS[@]}" -eq 0 ]; then
        echo "error: --build needs at least one source file" >&2; exit 2
    fi
    CC="afl-cc"
    command -v "$CC" >/dev/null 2>&1 || CC="afl-clang-fast"
    if ! command -v "$CC" >/dev/null 2>&1; then
        cat >&2 <<'EOF'
error: no AFL++ compiler (afl-cc / afl-clang-fast) found on PATH.
Install AFL++ first:
  Debian/Ubuntu : sudo apt-get install afl++
  From source   : https://github.com/AFLplusplus/AFLplusplus#building-and-installing-afl
EOF
        exit 3
    fi
    BIN="${OUT_DIR%/}.fuzz-target"
    echo "==> building with $CC: ${BUILD_SRCS[*]} -> $BIN"
    "$CC" -o "$BIN" "${BUILD_SRCS[@]}"
fi

if [ -z "$BIN" ] || [ ! -f "$BIN" ]; then
    echo "error: target binary not found: $BIN" >&2; exit 2
fi
[ -x "$BIN" ] || chmod +x "$BIN"
# afl-fuzz refuses a bare filename ("out.fuzz-target") with "not found or not executable" --
# it wants a path with a directory component, same as any `$PATH`-free exec. Live-tested: this
# exact fix turned that failure into a clean run.
case "$BIN" in
    */*) ;;
    *) BIN="./$BIN" ;;
esac

if [ "$QEMU" -eq 1 ] && ! command -v afl-qemu-trace >/dev/null 2>&1; then
    cat >&2 <<'EOF'
warning: --qemu was requested but afl-qemu-trace is not on PATH.
QEMU mode isn't built by the Debian/Ubuntu afl++ package by default -- build it once:
  <AFLplusplus checkout>/qemu_mode/build_qemu_support.sh
(https://github.com/AFLplusplus/AFLplusplus/blob/stable/qemu_mode/README.md)
Continuing anyway -- afl-fuzz will fail fast with its own clearer error if it truly can't run.
EOF
fi

command -v afl-fuzz >/dev/null 2>&1 || {
    echo "error: afl-fuzz not found on PATH (same AFL++ install as afl-cc above)" >&2
    exit 3
}

# ------------------------------------------------------------- seed scaffold
mkdir -p "$IN_DIR"
if [ -z "$(find "$IN_DIR" -type f 2>/dev/null)" ]; then
    echo "hello" > "$IN_DIR/seed1"
    echo "==> $IN_DIR was empty -- wrote a placeholder seed (afl-fuzz needs at least one)"
fi
mkdir -p "$(dirname "$OUT_DIR")" 2>/dev/null || true

AFL_ARGS=(-i "$IN_DIR" -o "$OUT_DIR")
[ -n "$TIMEOUT_MS" ] && AFL_ARGS+=(-t "$TIMEOUT_MS")
[ -n "$DURATION_S" ] && AFL_ARGS+=(-V "$DURATION_S")
[ "$QEMU" -eq 1 ] && AFL_ARGS+=(-Q)

if [ "${#TARGET_ARGS[@]}" -eq 0 ]; then
    TARGET_ARGS=("@@")
fi

echo "==> ThePunisher fuzz driver: afl-fuzz ${AFL_ARGS[*]} -- $BIN ${TARGET_ARGS[*]}"
afl-fuzz "${AFL_ARGS[@]}" -- "$BIN" "${TARGET_ARGS[@]}"

echo "==> done. crashes (if any): $OUT_DIR/default/crashes/"
