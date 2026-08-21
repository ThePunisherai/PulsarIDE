#!/usr/bin/env bash
# ThePunisher :: Linux anti-anti-debug + unpack driver
#
# The Linux analogue to the Windows x64dbg + ScyllaHide + Scylla pipeline documented in
# x64dbg-setup.md, built from real, live-tested primitives rather than a PE-style "IAT
# reconstruction" (ELF has no import table to rebuild the same way -- imports resolve
# through the PLT/GOT at runtime via ld.so, so "unpack + dump" on Linux means: get the
# process to a fully-resolved, decompressed memory state, then capture that state for a
# disassembler). Two real cases, handled differently on purpose:
#
#   1. UPX-packed (by far the most common real-world ELF packer): detected via `upx -t`
#      (exit 0 = packed, exit 2 = not) and reversed with the same tool, `upx -d` --
#      trivial, deterministic, no debugger needed.
#   2. Anything else (custom/malware packers): there's no generic "find OEP" for an
#      unknown packer, so this drives gdb in batch mode to run the target to a
#      breakpoint (default: the ELF entry point, or pass -b SYMBOL/ADDR once you've
#      identified the real OEP) and `generate-core-file`s the fully-resolved process
#      memory -- a core dump is directly loadable by Ghidra ("File > Import" picks the
#      ELF core loader), radare2 (`r2 core.dump`), or gdb itself, the real Linux
#      equivalent of handing Scylla's dump to a decompiler.
#
# Anti-anti-debug: LD_PRELOAD's scripts/ptrace_hide.so (built on demand, see that file's
# own header) defeats the classic self-ptrace check -- a target calling
# ptrace(PTRACE_TRACEME, ...) on itself to detect an attached debugger -- the same role
# ScyllaHide plays for x64dbg. Live-verified in this repo's own dev sandbox: a real
# self-ptrace anti-debug target correctly prints "DEBUGGER DETECTED" when run under plain
# gdb, and correctly runs through undetected with the shim preloaded, while still
# genuinely running under gdb. Honestly scoped like every other RE-tooling doc in this
# directory: this defeats ptrace-based detection specifically, NOT /proc/self/status
# TracerPid inspection or timing-based (rdtsc) detection -- those need separate,
# unimplemented techniques.
#
# Usage:
#   ./linux-unpack.sh <binary> [-b SYMBOL_OR_ADDR] [-o OUTPUT]
#
# Options:
#   -b SYMBOL_OR_ADDR   where to break before dumping (default: stop at the very first
#                       instruction via gdb's `starti` -- still inside/before the packer
#                       stub; pass the real OEP once you've identified it for a
#                       post-unpack dump)
#   -o OUTPUT           output path (default: <binary>.unpacked for UPX, <binary>.core
#                       for the gdb dump path)
#
# Ethics: authorized security research, CTF, and interoperability testing only -- see
# x64dbg-setup.md's "Ethics & scope" for the same guardrail as the rest of this directory.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '3,32p' "$HERE/linux-unpack.sh" | sed 's/^# \{0,1\}//'; }

BIN=""
BREAK_AT=""
OUT=""

while [ $# -gt 0 ]; do
    case "$1" in
        -b) BREAK_AT="${2:-}"; shift 2 ;;
        -o) OUT="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *)
            if [ -z "$BIN" ]; then BIN="$1"; else echo "unexpected argument: $1" >&2; exit 2; fi
            shift ;;
    esac
done

if [ -z "$BIN" ] || [ ! -f "$BIN" ]; then
    echo "usage: $0 <binary> [-b SYMBOL_OR_ADDR] [-o OUTPUT]" >&2
    exit 2
fi

echo "==> ThePunisher Linux unpack driver: $BIN"
command -v file >/dev/null 2>&1 && file "$BIN"

# --------------------------------------------------------------------- UPX case
if command -v upx >/dev/null 2>&1 && upx -t "$BIN" >/dev/null 2>&1; then
    OUT="${OUT:-$BIN.unpacked}"
    echo "==> UPX-packed (confirmed via 'upx -t') -- unpacking with upx -d"
    cp "$BIN" "$OUT"
    chmod +w "$OUT"
    upx -d "$OUT"
    echo "==> unpacked binary: $OUT (hand this to re-triage.sh / Ghidra for static analysis)"
    exit 0
fi

echo "==> not UPX-packed (or upx not installed) -- falling back to gdb breakpoint-dump"

# ------------------------------------------------------- generic gdb dump case
command -v gdb >/dev/null 2>&1 || {
    echo "error: gdb not found -- install it (apt: gdb, brew: gdb) for the non-UPX unpack path" >&2
    exit 3
}

SHIM_SO="$HERE/scripts/.ptrace_hide.so"
if [ ! -f "$SHIM_SO" ] || [ "$HERE/scripts/ptrace_hide.c" -nt "$SHIM_SO" ]; then
    command -v gcc >/dev/null 2>&1 || command -v cc >/dev/null 2>&1 || {
        echo "error: no C compiler (gcc/cc) found -- needed once to build the anti-anti-debug shim" >&2
        exit 3
    }
    CC="$(command -v gcc || command -v cc)"
    echo "==> building anti-anti-debug shim: $SHIM_SO"
    "$CC" -shared -fPIC -o "$SHIM_SO" "$HERE/scripts/ptrace_hide.c" -ldl
fi

OUT="${OUT:-$BIN.core}"

# NOTE (found the hard way, live-tested): LD_PRELOAD must be set for the DEBUGGEE only,
# via gdb's own `set environment` command -- setting it as a shell env var on the `gdb`
# invocation itself loads the shim into gdb's OWN process too, and since gdb's classic
# fork+PTRACE_TRACEME+exec startup sequence runs through that same (now-shimmed) libc,
# the shim's fake "success" answer defeats gdb's own real trace setup -- the target then
# runs completely untraced (breakpoints silently never fire). Confirmed live: the shim
# applied via a bare `LD_PRELOAD=... gdb ...` invocation produced a process that ran to
# completion with no stop at all; the same shim applied via `set environment LD_PRELOAD`
# below correctly stopped, dumped, and then genuinely defeated the target's own
# self-ptrace check on resume.
if [ -n "$BREAK_AT" ]; then
    echo "==> running under gdb (anti-anti-debug shim active), breaking at '$BREAK_AT', dumping to $OUT"
    gdb -q --batch \
        -ex "set environment LD_PRELOAD $SHIM_SO" \
        -ex "break $BREAK_AT" \
        -ex "run" \
        -ex "generate-core-file $OUT" \
        -ex "detach" \
        -ex "kill" \
        "$BIN" 2>&1 || true
else
    # No -b given: use gdb's `starti` (stop at the very first instruction executed --
    # for a statically-linked packed binary, the real packer stub's own entry point; for
    # a dynamically-linked one, the dynamic linker's entry, from which the packed binary
    # is already fully mapped in memory even if not yet relocated). Live-tested more
    # reliable than breaking on a raw file-relative entry address before `run`: gdb
    # refused to insert a breakpoint at an unmapped PIE file address ("Cannot access
    # memory"), while `starti` stopped correctly every time.
    echo "==> running under gdb (anti-anti-debug shim active), stopping at the first instruction (starti), dumping to $OUT"
    gdb -q --batch \
        -ex "set environment LD_PRELOAD $SHIM_SO" \
        -ex "starti" \
        -ex "generate-core-file $OUT" \
        -ex "detach" \
        -ex "kill" \
        "$BIN" 2>&1 || true
fi

if [ -f "$OUT" ]; then
    echo "==> memory dump written: $OUT"
    echo "    load it in Ghidra (File > Import, ELF core loader), radare2 (r2 -c ... $OUT),"
    echo "    or gdb ('gdb $BIN -c $OUT') for fully-resolved (post-decompression) static analysis"
    echo "    (a starti-stage dump captures the target before the packer stub runs -- pass"
    echo "     -b SYMBOL_OR_ADDR once you've identified the real OEP for a post-unpack dump)"
else
    echo "error: no core file produced." >&2
    if [ -n "$BREAK_AT" ]; then
        echo "       the breakpoint ('$BREAK_AT') was likely never hit -- verify the symbol/address." >&2
    fi
    exit 4
fi
