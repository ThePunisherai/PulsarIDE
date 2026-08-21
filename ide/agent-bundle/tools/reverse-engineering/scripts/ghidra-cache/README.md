# Ghidra script cache

A reuse cache for **Ghidra headless post-scripts** (`-postScript <name>.py -scriptPath
tools/reverse-engineering/scripts/ghidra-cache`) that ThePunisher's RE agents have already
written and *confirmed working*. The point is speed: writing a correct headless Ghidra Python
script (imports, `currentProgram`/`FlatProgramAPI` calls, output format) takes real iteration —
caching a validated one turns a repeat analysis into "run this script" instead of "write this
script again from scratch."

## The rule: only validated scripts go here

A script is added to this directory **only after** it has actually run successfully end-to-end
against a real binary via `analyzeHeadless` and produced correct, non-empty, non-error output —
not on the first draft, not "looks right." An agent that writes a one-off script for a single
target's quirks does **not** cache it here; that belongs in `research/<target>/` instead (see
`research/README.md` at the repo root) or nowhere at all if it's truly single-use.

Before writing a new script, check here first — `ghidra_triage.py` (one directory up) is the
one general-purpose script always in the default triage path (`re-triage.sh`); anything more
specific (find AES S-boxes, dump a particular struct layout, resolve a known obfuscation
pattern) that's been solved before should be reused, not reinvented.

## Naming and format

- Filename: `<verb>_<what>.py`, e.g. `find_crypto_constants.py`, `dump_vtable_layout.py`.
- Header docstring: what it does, the exact `analyzeHeadless` invocation that validated it, and
  the date it was last confirmed working — so a future agent can tell if it's stale (Ghidra API
  changes between major versions occasionally break scripts).
- Prints plain text or JSON to stdout — matches `ghidra_triage.py`'s convention so output is
  pipeable into the same triage flow.

## Empty by design

This directory starts empty (just this README) — it fills up as real analyses produce real,
validated scripts. Don't pre-populate it with speculative scripts nobody has run yet.
