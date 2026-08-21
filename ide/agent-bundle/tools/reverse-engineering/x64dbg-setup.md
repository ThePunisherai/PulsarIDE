# x64dbg + Scylla — RE Tooling Setup (Team 5)

x64dbg is ThePunisher's primary **Windows-native** debugger. This directory provisions x64dbg
together with **Scylla** (import reconstruction / process dump), **ScyllaHide**
(anti-anti-debug), and the rest of the standard RE plugin suite, plus headless scripts the
agents drive.

> **Platform note.** x64dbg is a Windows application. Install it on Windows (native, a Windows
> VM, or Wine). `install-x64dbg.ps1` is the supported installer. On Linux/macOS the agents use
> Ghidra / radare2 / Frida for the equivalent work; x64dbg tasks are dispatched to a Windows
> worker.

---

## What gets installed

| Component | Repo / source | Role |
| --------- | ------------- | ---- |
| **x64dbg** | https://github.com/x64dbg/x64dbg/releases (snapshot) | x64/x32 debugger + built-in **Scylla** (Plugins → Scylla) |
| **Scylla** (standalone) | https://github.com/NtQuery/Scylla | IAT rebuild + dump, standalone GUI/CLI |
| **ScyllaHide** | https://github.com/x64dbg/ScyllaHide/releases | Anti-anti-debug (hides debugger from checks) |
| **xAnalyzer** | https://github.com/ThirteenAG/xAnalyzer/releases | API arg resolution, extended analysis |
| **OllyDumpEx** | https://low-priority.appspot.com/ollydumpex/ | Process/module dumping |
| **Labelless** | https://github.com/hasherezade/labelless (or fork) | Sync labels/comments with IDA |
| **SwissArmyKnife** | https://github.com/x64dbg/SwissArmyKnife | Assembler/patcher utilities |

> Scylla ships **inside** x64dbg already (menu: Plugins → Scylla). The standalone Scylla is
> installed too for scripted/headless dumping and for use outside a live debug session.

Plugin DLLs are copied into:

```
x64dbg\release\x64\plugins\    # 64-bit plugins  (*.dp64)
x64dbg\release\x32\plugins\    # 32-bit plugins  (*.dp32)
```

---

## Install (Windows / PowerShell)

```powershell
# From an elevated PowerShell in this directory:
powershell -ExecutionPolicy Bypass -File .\install-x64dbg.ps1

# Options:
#   -InstallDir "C:\Tools\x64dbg"   # default: %LOCALAPPDATA%\ThePunisher\x64dbg
#   -SkipPlugins                    # x64dbg only, no plugin suite
#   -Verify                         # only verify an existing install
```

The script:
1. Downloads the latest x64dbg release snapshot and extracts it.
2. Downloads each plugin release and copies the correct `.dp32` / `.dp64` into the plugin dirs.
3. Writes `x64dbg\release\plugins-manifest.json` recording versions + SHA-256 of every file.
4. Runs a verification pass (`-Verify`) confirming every expected DLL is present.

---

## Headless / scripted usage

x64dbg has a built-in script engine. ThePunisher drives it non-interactively:

```powershell
# Run an analysis script against a target and exit
x64dbg.exe -script "scripts\analyze_binary.x64dbg.txt" "C:\samples\target.exe"

# Unpack + Scylla dump (ScyllaHide hides the debugger the whole time)
x64dbg.exe -script "scripts\scylla_dump.x64dbg.txt" "C:\samples\packed.exe"
```

For full programmatic control, the **x64dbgpy** plugin exposes a Python API, and **Scylla** ships
a headless import-reconstruction API (`Scylla.dll` exports / `scylla_cli`) that
`ThePunisher-UnpackerExpert` uses to rebuild the IAT after reaching the OEP.

> **Honest limitation.** x64dbg has no official headless/hidden-window mode — only 3 basic CLI
> args (target, cmdline, currentdir), confirmed against
> [help.x64dbg.com](https://help.x64dbg.com/en/latest/introduction/Commandline.html), and a
> feature request for WinDbg/GDB-style command-line options
> ([x64dbg/x64dbg#2201](https://github.com/x64dbg/x64dbg/issues/2201)) remains open upstream. The
> `-script` flag above drives it **non-interactively** (no clicking required once launched), but
> the GUI process itself must stay alive on a Windows desktop session — this is a real constraint
> of the tool, not a gap in this repo's scripting. Ghidra's `analyzeHeadless` (used by
> `re-triage.sh` on Linux/macOS) has no such limitation.

---

## ScyllaHide profile (anti-anti-debug)

ScyllaHide ships `scylla_hide.ini`. ThePunisher's default profile enables the common hides so a
protected sample can't detect the debugger:

```ini
[SETTINGS]
Profile=ThePunisher

[ThePunisher]
PEB_BeingDebugged=1
PEB_HeapFlags=1
PEB_NtGlobalFlag=1
NtQueryInformationProcess_ProcessDebugFlags=1
NtQueryInformationProcess_ProcessDebugObjectHandle=1
NtQueryInformationProcess_ProcessDebugPort=1
NtSetInformationThread_ThreadHideFromDebugger=1
NtQueryObject_ObjectTypeInformation=1
NtQueryObject_ObjectAllTypesInformation=1
OutputDebugStringA=1
BlockInput=1
GetTickCount=1
GetTickCount64=1
NtQueryPerformanceCounter=1
NtQuerySystemTime=1
```

`install-x64dbg.ps1` writes this profile next to the ScyllaHide plugin.

---

## Typical unpack → dump workflow (UnpackerExpert)

1. Load the packed sample in x64dbg with **ScyllaHide active** (Plugins → ScyllaHide → profile
   `ThePunisher`).
2. Break on the packer's tail transition / hardware breakpoint to reach the **OEP**.
3. Open **Plugins → Scylla**, click *IAT Autosearch* → *Get Imports* → *Fix Dump*.
4. Scylla rebuilds the import table and writes a clean, statically-analyzable binary.
5. Hand the dump to `ThePunisher-DecompilerExpert` (Ghidra/r2) for annotation.

The `scripts/scylla_dump.x64dbg.txt` script automates steps 1–4 for common packers.

---

## Ethics & scope

This tooling is for **authorized** malware analysis, CTF, interoperability research, and
education. Do not use it to strip licensing/DRM you have no right to bypass or to build
weaponized evasion against a specific victim's defenses.
