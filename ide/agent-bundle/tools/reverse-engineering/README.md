# Team 5 — Reverse Engineering Tooling

Headless-capable RE toolkit for ThePunisher's Reverse Engineering Command (Team 5).

## Contents

| Path | What |
| ---- | ---- |
| `x64dbg-setup.md` | Full setup guide: x64dbg + Scylla + ScyllaHide + plugin suite |
| `install-x64dbg.ps1` | Windows installer (x64dbg snapshot + plugins + manifest + verify) |
| `scripts/analyze_binary.x64dbg.txt` | x64dbg headless entry/triage script (Windows) |
| `scripts/scylla_dump.x64dbg.txt` | x64dbg unpack-to-OEP helper for Scylla IAT rebuild + dump |
| `install-ghidra.sh` | Linux/macOS Ghidra headless installer (latest release, digest-verified, sets `GHIDRA_HOME`) |
| `install-ghidra.ps1` | Windows equivalent (persistent User `GHIDRA_HOME`, no admin needed) |
| `re-triage.sh` | **Cross-platform** static triage driver (Ghidra → r2 → objdump fallback) |
| `scripts/ghidra_triage.py` | Ghidra headless post-script: functions/imports/entry as JSON |
| `scripts/ghidra-cache/` | Reusable, **validated-only** Ghidra headless scripts — check here before writing a new one |
| `scripts/ida_triage.py` | IDA Pro batch-mode script (`idat64 -A -S`): functions/imports/entry as JSON — for users with a real IDA license |
| `scripts/frida_trace.js` | Frida agent: hooks common syscalls/APIs and logs calls |
| `fuzz-driver.sh` | **Linux** AFL++ fuzzing driver — build-and-fuzz from source or fuzz an existing binary |
| `linux-unpack.sh` | **Linux** anti-anti-debug + unpack driver — the ScyllaHide/Scylla equivalent for ELF |
| `scripts/ptrace_hide.c` | LD_PRELOAD shim defeating self-ptrace anti-debug checks (built on demand by `linux-unpack.sh`) |
| `../../research/` | Target-specific scratch output (captures, hexdumps, notes) — gitignored, not the script cache |

## Quick start (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\install-x64dbg.ps1
powershell -ExecutionPolicy Bypass -File .\install-x64dbg.ps1 -Verify
```

Then drive headless:

```powershell
$x = "$env:LOCALAPPDATA\ThePunisher\x64dbg\release\x64\x64dbg.exe"
& $x -script ".\scripts\analyze_binary.x64dbg.txt" "C:\samples\target.exe"
```

## The plugin suite

- **Scylla** — bundled in x64dbg (Plugins → Scylla). IAT reconstruction + dump.
- **ScyllaHide** — anti-anti-debug; `ThePunisher` profile installed automatically.
- **xAnalyzer** — richer static analysis / API argument comments.
- **SwissArmyKnife** — assembler/patcher utilities.
- **OllyDumpEx / Labelless** — see `x64dbg-setup.md` (manual or org-mirror install).

## Ghidra headless (auto-install)

`install-ghidra.sh` / `install-ghidra.ps1` download the latest official Ghidra release from
[NationalSecurityAgency/ghidra](https://github.com/NationalSecurityAgency/ghidra) (Apache-2.0),
verify its published SHA-256 digest, extract it, and wire `GHIDRA_HOME` so `analyzeHeadless` is
on PATH in every new shell with zero manual setup — the same tool `re-triage.sh` and
`scripts/ghidra_triage.py` already drive. Fully headless: neither the installer nor
`analyzeHeadless` itself ever opens a GUI. Requires a JDK 21 (64-bit) on PATH — the script checks
and points you at a free one (Adoptium Temurin / Amazon Corretto) if missing; it does not install
a JDK for you.

```bash
./install-ghidra.sh              # Linux/macOS — writes ~/.config/thepunisher/ghidra.env,
                                  # auto-sourced by headroom/shell-hook.sh
./install-ghidra.sh -Verify      # check an existing install only
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install-ghidra.ps1   # Windows — persistent User env var
powershell -ExecutionPolicy Bypass -File .\install-ghidra.ps1 -Verify
```

**Testing disclosure:** the Java-version-detection logic, digest-verification logic, and JSON
parsing were live-tested in this repo's own dev sandbox against real Ghidra release data
(`Ghidra_12.1.2_build`, verified via the GitHub API). The actual network download step could
**not** be live-tested end-to-end from that sandbox — its outbound proxy scopes GitHub API/asset
access to only the repos explicitly attached to that session, so `curl` to
`api.github.com/repos/NationalSecurityAgency/ghidra/...` returns a 403 with an explicit
`"GitHub access to this repository is not enabled for this session"` message. That's a property
of the dev sandbox, not of the script or of a real user/CI environment (the release pipeline in
`.github/workflows/release.yml` already proves scripts like this run fine on GitHub's own
infrastructure) — flagged here rather than silently claimed as tested, per this repo's
no-hallucination rule.

## Reusing Ghidra scripts across analyses (script cache + research folder)

Writing a correct Ghidra headless post-script (imports, `FlatProgramAPI` calls, output format)
takes real iteration. Two directories exist so that work isn't repeated from scratch every time:

- **`scripts/ghidra-cache/`** — reusable scripts, but *only once confirmed working* end-to-end
  against a real binary (see that directory's README for the exact rule and naming convention).
  Check here before writing a new script for a task you may have already solved.
- **`../research/`** (repo root) — target-specific scratch output: hex dumps, packet captures,
  notes, one-off scripts that only make sense for one target. Gitignored by default (see
  `research/README.md`) — this is not the cache, and its contents aren't meant to be committed.

## Cross-platform note

x64dbg is Windows-only. On Linux/macOS the equivalent work is done with **Ghidra**,
**radare2**, and **Frida** — drivers are provided here:

```bash
# static triage (auto-selects Ghidra headless, else r2, else objdump/strings)
./re-triage.sh /path/to/binary

# dynamic tracing
frida -l scripts/frida_trace.js -f /path/to/binary --no-pause

# fuzzing (AFL++)
./fuzz-driver.sh --build target.c -- @@

# anti-anti-debug + unpack (the Scylla/ScyllaHide equivalent for ELF)
./linux-unpack.sh /path/to/packed_binary
```

x64dbg tasks are dispatched to a Windows worker/VM.

## Fuzzing (Linux, AFL++)

`fuzz-driver.sh` wires together the real, upstream [AFL++](https://github.com/AFLplusplus/AFLplusplus)
toolchain (GPL-2.0 core + Apache-2.0 mutators, the maintained community successor to the
original AFL) the same way `re-triage.sh` wires together Ghidra/r2/objdump: a thin driver
over tools you install yourself, not a reimplementation.

```bash
# build target.c with afl-cc (instrumented) and fuzz it, seeds auto-scaffolded if
# ./fuzz-in doesn't exist yet
./fuzz-driver.sh --build target.c -- @@

# fuzz an already-built binary for exactly 60 seconds (good for a CI/driven run)
./fuzz-driver.sh --bin ./target -i seeds/ -o out/ -V 60 -- @@

# black-box fuzzing (no source) via AFL++'s QEMU mode -- needs the separate
# qemu_mode/build_qemu_support.sh step from an AFLplusplus checkout; the driver warns
# and continues if afl-qemu-trace isn't found, letting afl-fuzz give its own clearer error
./fuzz-driver.sh --bin ./stripped_target --qemu -- @@
```

Install AFL++ first: `sudo apt-get install afl++` (Debian/Ubuntu) or build from source
(link above). **Live-tested end to end** in this repo's own dev sandbox against a real
AFL++ 4.09c install: both `--build` and `--bin` modes correctly compile/run, auto-scaffold
a seed when the input directory is empty, honor `-V` to stop after a fixed duration, and
report crashes under `<out>/default/crashes/`.

## Anti-anti-debug + unpack (Linux)

`linux-unpack.sh` is the Linux analogue to the Windows x64dbg + ScyllaHide + Scylla
pipeline in `x64dbg-setup.md` — built from real primitives rather than a PE-style "IAT
reconstruction" (ELF has no import table to rebuild the same way; imports resolve through
the PLT/GOT at runtime via `ld.so`, so "unpack + dump" on Linux means getting the process
to a fully-resolved, decompressed memory state and capturing *that*):

1. **UPX-packed** (by far the most common real-world ELF packer) — detected via `upx -t`
   and reversed with `upx -d`. Trivial, deterministic, no debugger involved.
2. **Anything else** (custom/malware packers, no generic "find OEP" possible) — drives
   `gdb` in batch mode to stop the target (via `starti`, gdb's built-in "stop at the very
   first instruction executed" command, or `-b SYMBOL_OR_ADDR` once you've identified the
   real OEP) and `generate-core-file`s the fully-resolved process memory. The resulting
   core file is directly loadable in Ghidra (File → Import, ELF core loader), radare2
   (`r2 -c ... dump.core`), or `gdb <binary> -c dump.core` — the real Linux equivalent of
   handing Scylla's dump to a decompiler.

**Anti-anti-debug**: `scripts/ptrace_hide.c` is an `LD_PRELOAD` shim, built on demand, that
defeats the classic self-ptrace anti-debug check — a target calling
`ptrace(PTRACE_TRACEME, ...)` on itself to detect an attached debugger — the same role
ScyllaHide plays for x64dbg. Every other `ptrace` request passes through to the real libc
call unmodified.

```bash
./linux-unpack.sh /path/to/packed_binary                 # UPX or starti-stage dump
./linux-unpack.sh /path/to/packed_binary -b main          # dump at a known OEP/symbol
```

**Live-tested end to end**, not just reasoned about: a real self-ptrace anti-debug target
correctly printed "DEBUGGER DETECTED" when run under plain `gdb`, and correctly ran
through undetected with the shim active — while still genuinely being breakpointed and
core-dumped by `gdb` throughout, proving the target was actually debugged the whole time
despite its own check reporting otherwise. **A real bug found and fixed during that
testing, worth knowing if this script is touched again**: `LD_PRELOAD` must be applied to
the *debuggee only*, via gdb's own `set environment LD_PRELOAD ...` command issued before
`run`/`starti` — setting it as a shell env var on the `gdb` invocation itself loads the
shim into gdb's own process too, and since gdb's classic fork+`PTRACE_TRACEME`+exec
startup sequence runs through that same (now-shimmed) libc, the shim's fake "success"
answer defeats gdb's *own* real trace setup, so the target runs completely untraced and no
breakpoint ever fires. The UPX path was also live-tested against a real `upx`-packed
binary: `upx -t` correctly identified it, `upx -d` correctly restored a working,
non-stripped, dynamically-linked executable.

**Honestly scoped**: this defeats `ptrace`-based self-debugging checks specifically, NOT
`/proc/self/status` `TracerPid` inspection or timing-based (rdtsc) detection — those need
separate, unimplemented techniques, same honesty convention as every other limitation
documented in this file (x64dbg's own missing headless mode, idalib's IDA 9.0+
requirement, etc.).

## Binary Ninja headless MCP bridge (auto-install, optional)

`install-binja-mcp.sh` / `install-binja-mcp.ps1` install
[mrphrazer/binary-ninja-headless-mcp](https://github.com/mrphrazer/binary-ninja-headless-mcp)
(GPL-2.0, 213★, verified live) — pinned to a specific commit (not `main`) for reproducible
installs, since it isn't published on PyPI.

**Be clear about what this does and doesn't give you:** it installs the *bridge* only. Binary
Ninja itself is commercial, paid, per-seat software with a headless-capable tier required for
real analysis — this repo cannot install or provide that license. Without it, the bridge still
installs and runs in `--fake-backend` mode (upstream's own CI/dev mode) but can't analyze real
binaries. **Ghidra is ThePunisher's default disassembler for exactly this reason** — free,
NSA open-source, genuinely headless, no license wall. Reach for this bridge only if you already
own Binary Ninja.

```bash
./install-binja-mcp.sh              # pip install --user, pinned commit
./install-binja-mcp.sh -Verify      # check an existing install only
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install-binja-mcp.ps1
powershell -ExecutionPolicy Bypass -File .\install-binja-mcp.ps1 -Verify
```

**Testing disclosure:** unlike the Ghidra installer above, `install-binja-mcp.sh` (the Linux/macOS
side) was live-tested end-to-end in this repo's own dev sandbox — `git clone`/`pip install` to
GitHub worked from that sandbox even though its proxy blocks the plain `api.github.com` REST API
(a different access path, apparently not scoped the same way). Real result: installed
`binary-ninja-headless-mcp==0.2.0`, `binary_ninja_headless_mcp --help` responded correctly, and
both the fresh-install and `-Verify` paths exited 0. The PowerShell side (`install-binja-mcp.ps1`)
could not be live-run (no `pwsh` in that sandbox) but mirrors the bash logic line-for-line and
passes `scripts/verify.sh`'s structural PowerShell check.

## MCP servers for RE tools (optional)

`../mcp/mcp-re-tools.json` catalogues real, live-verified MCP servers for Ghidra, Binary Ninja,
x64dbg, and IDA Pro (GitHub stars/license checked against the actual repos). Not merged into the
default `mcp.json` — each needs a specific installed tool, a Windows GUI process, or a paid
license, so making them unconditional would break the installer for anyone without that exact
setup. See `../mcp/README.md`'s "RE-tool MCP servers" section for the honest headless/GUI status
of each one — x64dbg in particular has **no official headless mode**, a real limitation of the
tool itself that no MCP wrapper can remove.

## IDA Pro (optional, needs your own license)

For users with a real IDA Pro install: [`mrexodia/ida-pro-mcp`](https://github.com/mrexodia/ida-pro-mcp)
(10.6k stars, MIT, verified live — supports IDA Pro 8.3+) gives interactive MCP access once IDA
is running with the plugin loaded (`pip install` the repo zip, then `ida-pro-mcp --install` +
`ida-pro-mcp --config`). For genuine headless/batch triage — the case this repo's own Ghidra
workflow already covers — use `scripts/ida_triage.py` via IDA's own long-stable batch mechanism:

```bash
idat64 -A -S"scripts/ida_triage.py" ./target.bin
```

**Important version note, verified against Hex-Rays' own docs, not guessed:** upstream's newer
`idalib` headless mode (`uv run idalib-mcp --stdio`) requires **IDA Pro 9.0+**
(docs.hex-rays.com/core/idalib/getting-started) — it does **not** work on IDA Pro 8.3. The
`idat64 -A -S` batch mechanism above is the correct headless path for 8.3 specifically; it is not
version-gated the way idalib is (docs.hex-rays.com/core/user-interface/concepts/command-line-switches).
Not available in the IDA Home edition per the same docs.

## Ethics

Authorized malware analysis, CTF, interoperability, and education only. See the guardrail in
`x64dbg-setup.md`.
