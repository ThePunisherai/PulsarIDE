#!/usr/bin/env bash
# PlanIDE IDE-overlay self-test.
#
# Verifies the overlay is well-formed and still applies cleanly to a real Orca
# checkout -- the thing that actually breaks when upstream moves. Skips the
# apply test (rather than failing) when no checkout is present, so it stays
# useful on a machine that has not run ide/build.sh yet.
#
#   ./ide/verify.sh                 # uses ide/.work/pristine, else ide/.work/orca
#   ./ide/verify.sh <orca-path>     # verify against a specific checkout
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CHECKOUT="${1:-}"
# Prefer the pristine snapshot (ide/fetch-upstream.sh): applying to a checkout
# build.sh already patched can pass on anchors our own earlier run created.
if [ -z "$CHECKOUT" ]; then
  if [ -f "$HERE/.work/pristine/package.json" ]; then CHECKOUT="$HERE/.work/pristine"
  else CHECKOUT="$HERE/.work/orca"; fi
fi

PASS=0; FAIL=0; SKIP=0
ok()   { echo "  PASS $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL $1"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP $1"; SKIP=$((SKIP+1)); }

echo "== PlanIDE IDE overlay verify =="

# 1. our own sources are syntactically sound
python3 -m py_compile "$HERE/apply.py" 2>/dev/null \
  && ok "apply.py compiles" || bad "apply.py compiles"
bash -n "$HERE/build.sh" 2>/dev/null \
  && ok "build.sh parses" || bad "build.sh parses"

# 1a2. Every child process the main process launches must pass windowsHide.
# Electron's main process has no console of its own, so on Windows a console
# program launched without it gets a brand new console window on the user's
# screen -- which is exactly what graphify.exe did, for the whole run.
# Count real call sites, not lines: grep -c counts matching lines, and an import
# line names these functions without calling them. Drop the imports first, then
# count occurrences with -o. Longest alternative first, so execFileSync( is not
# counted as execFile( plus a stray "Sync".
missing=""
for f in "$HERE"/overlay/src/main/planide/*.ts; do
  calls=$(grep -vE "^import " "$f" \
          | grep -oE "(execFileSync|execFile|spawn)\\(" | wc -l | tr -d ' ')
  [ "$calls" -eq 0 ] && continue
  hidden=$(grep -oE "windowsHide: true" "$f" | wc -l | tr -d ' ')
  [ "$hidden" -lt "$calls" ] && missing="$missing $(basename "$f")($hidden/$calls)"
done
if [ -z "$missing" ]; then
  ok "every child process is launched with windowsHide (no stray console windows)"
else
  bad "a child process would open a console window on Windows:$missing"
fi

# 1b. a release publishes CHANGELOG.md as its notes, so an entry for the current
# version is part of shipping it, not an afterthought.
ver=$(cat "$ROOT/agent-tools/VERSION" 2>/dev/null | tr -d '[:space:]')
if grep -q "^## \[$ver\]" "$ROOT/CHANGELOG.md" 2>/dev/null; then
  ok "CHANGELOG.md has an entry for $ver"
else
  bad "CHANGELOG.md has no '## [$ver]' section (the release page would be empty)"
fi

# 2. every file apply.py promises to copy actually exists
missing=0
for rel in $(python3 -c "
import sys; sys.path.insert(0,'$HERE')
import importlib.util
s=importlib.util.spec_from_file_location('a','$HERE/apply.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
print('\n'.join(m.OVERLAY_FILES))"); do
  [ -f "$HERE/overlay/$rel" ] || { echo "    missing overlay/$rel"; missing=1; }
done
[ "$missing" = 0 ] && ok "every OVERLAY_FILES entry exists" || bad "OVERLAY_FILES has missing files"

# ...and the other direction, which is the one that actually bites: a new source
# file that nobody added to OVERLAY_FILES is never copied into the checkout, so
# the build breaks on an import that resolves fine here.
listed=$(python3 -c "
import sys, importlib.util
s = importlib.util.spec_from_file_location('a', '$HERE/apply.py')
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
print('\n'.join(m.OVERLAY_FILES))")
unlisted=0
while read -r f; do
  rel="${f#$HERE/overlay/}"
  echo "$listed" | grep -qx "$rel" || { echo "    not in OVERLAY_FILES: $rel"; unlisted=1; }
done < <(find "$HERE/overlay/src" -name "*.ts" -o -name "*.tsx" | sort)
[ "$unlisted" = 0 ] && ok "every overlay source file is in OVERLAY_FILES" \
                    || bad "an overlay source file would never be copied"

# 2b. ...and every renderer component is actually TYPECHECKED here.
# A component missing from tsconfig.check.json's include is silently skipped by
# the local typecheck and only fails in CI, on a real build -- which is exactly
# how PulseMemory.tsx shipped importing a module path that does not exist.
missing_tc=0
while read -r f; do
  rel="../overlay/${f#$HERE/overlay/}"
  grep -qF "\"$rel\"" "$HERE/design/tsconfig.check.json" \
    || { echo "    not in tsconfig.check.json: $rel"; missing_tc=1; }
done < <(find "$HERE/overlay/src/renderer" -name "*.tsx" -o -name "*.ts" | sort)
[ "$missing_tc" = 0 ] && ok "every renderer component is in the typecheck" \
                      || bad "a renderer component is never typechecked locally"

# 3. TypeScript in the overlay is syntactically valid
if command -v npx >/dev/null 2>&1; then
  # --noResolve keeps this dependency-free, at the cost of two known false
  # positives that only appear because React's types are not loaded:
  #   * "Property 'key' does not exist"  -- `key` is a real React prop
  #   * "implicitly has an 'any' type"   -- callback params typed via React
  # Both were confirmed clean in a separate run against real @types/react.
  # Everything else here is a genuine error.
  # `npx tsc` is a trap: with nothing installed it resolves to an abandoned
  # squatter package that prints "This is not the tsc command you are looking
  # for" and exits 0. Name the real compiler, and prefer the pinned copy the
  # design harness already installed.
  if [ -x "$HERE/design/.work/node_modules/.bin/tsc" ]; then
    TSC=("$HERE/design/.work/node_modules/.bin/tsc")
  else
    TSC=(npx --yes --package typescript@5 tsc)
  fi
  # Every overlay source file, found rather than listed. A hardcoded list is how
  # memory-status.ts, board-watch.ts and PulseMemory.tsx all ended up outside the
  # syntax check without anyone noticing -- a new file simply never joined it.
  mapfile -t TS_SOURCES < <(cd "$HERE/overlay" && find src -name '*.ts' -o -name '*.tsx' | sort)
  out=$(cd "$HERE/overlay" && "${TSC[@]}" --noEmit --noResolve \
        --jsx react-jsx --target es2022 --module esnext --moduleResolution bundler --skipLibCheck \
        "${TS_SOURCES[@]}" 2>&1 \
        | grep -vE "Cannot find module|Cannot find name|has no exported member|implicitly has an 'any'|Cannot find namespace|JSX element implicitly|react/jsx-runtime|Property 'key' does not exist|Type '\{ key:")
  [ -z "$out" ] && ok "overlay TypeScript has no syntax errors" \
                || { bad "overlay TypeScript"; echo "$out" | head -5; }
else
  skip "overlay TypeScript (npx unavailable)"
fi

# 3b. the stronger typecheck: real React/lucide/radix types, and Orca's own
# Button, instead of the dependency-free --noResolve pass above. Needs the
# design harness (ide/design/setup.sh), so it skips rather than fails without it.
if [ -d "$HERE/design/.work/node_modules/typescript" ]; then
  out=$(cd "$HERE/design" && ./.work/node_modules/.bin/tsc -p tsconfig.check.json 2>&1)
  [ -z "$out" ] && ok "overlay TypeScript typechecks against real React types" \
                || { bad "overlay TypeScript (real types)"; echo "$out" | head -5; }
else
  skip "real-types typecheck (run ide/design/setup.sh)"
fi

# 3c. ...and the MAIN-process sources, which nothing above covers. A type error
# in main/planide/*.ts used to surface only in Orca's own CI typecheck, i.e.
# after a push -- the same gap that once shipped a release with no installers.
if [ -d "$HERE/design/.work/node_modules/typescript" ]; then
  out=$(cd "$HERE/design" && ./.work/node_modules/.bin/tsc -p tsconfig.main.json 2>&1)
  [ -z "$out" ] && ok "main-process TypeScript typechecks (strict, real node types)" \
                || { bad "main-process TypeScript"; echo "$out" | head -5; }
  # ...and no main-process file may quietly escape that check.
  missing_mc=0
  for f in "$HERE"/overlay/src/main/planide/*.ts; do
    rel="../overlay/src/main/planide/$(basename "$f")"
    # ipc.ts is knowingly out: it imports electron, whose types are not here.
    [ "$(basename "$f")" = "ipc.ts" ] && continue
    grep -qF "\"$rel\"" "$HERE/design/tsconfig.main.json" \
      || { echo "    not in tsconfig.main.json: $rel"; missing_mc=1; }
  done
  [ "$missing_mc" = 0 ] && ok "every main-process source is in the typecheck" \
                        || bad "a main-process source is never typechecked locally"
else
  skip "main-process typecheck (run ide/design/setup.sh)"
fi

# 4. the tracker itself: run the real main-process modules
if command -v npx >/dev/null 2>&1; then
  work=$(mktemp -d)
  if npx --yes esbuild "$HERE/test/tracker.test.ts" --bundle --platform=node --format=cjs \
       --outfile="$work/tracker.cjs" --external:electron --log-level=error >/dev/null 2>&1; then
    out=$(PLANIDE_ZIP_OUT="$work/zip.txt" node "$work/tracker.cjs" 2>&1)
    if echo "$out" | grep -q "FAIL=0"; then
      ok "tracker: $(echo "$out" | grep -oE 'PASS=[0-9]+') behaviour checks"
    else
      bad "tracker behaviour"; echo "$out" | grep "FAIL " | head -5
    fi
    # The ZIP writer is ours; prove an independent reader accepts what it wrote.
    zip=$(cat "$work/zip.txt" 2>/dev/null)
    if [ -n "$zip" ] && command -v python3 >/dev/null 2>&1; then
      python3 -c "
import sys, zipfile
with zipfile.ZipFile('$zip') as f:
    sys.exit(0 if f.testzip() is None and len(f.namelist()) > 0 else 1)" 2>/dev/null \
        && ok "tracker: hand-written ZIP validates in an independent reader" \
        || bad "tracker: ZIP is not a valid archive"
    fi
  else
    bad "tracker: test bundle failed to build"
  fi
  rm -rf "$work"
else
  skip "tracker behaviour (npx unavailable)"
fi

# 3c. the locale rebrand: app identity -> PulsarIDE, but Orca's own external
# services (Cloud/Relay/Mobile/account/CLI/star link) stay verbatim.
if [ -f "$CHECKOUT/src/renderer/src/i18n/locales/en.json" ]; then
  out=$(python3 "$HERE/check-locale.py" "$CHECKOUT" 2>&1)
  if echo "$out" | grep -q "^ok "; then
    ok "locale rebrand ($(echo "$out" | grep -oE '[0-9]+ rebranded / [0-9]+ left'))"
  else
    bad "locale rebrand"; echo "$out" | head -4
  fi
else
  skip "locale rebrand (no en.json -- run ./ide/fetch-upstream.sh)"
fi

# 3d. the inline source-string rebrand (patch_source_strings): the fix for "I
# still see Orca everywhere". Orca's English UI uses inline translate() fallbacks
# and raw literals that never reach the locale JSON, so this rebrands the product
# name inside string literals of the app source. Unit-tested on synthetic input
# (no full checkout needed): product name -> PulsarIDE inside strings, while
# comments, lowercase `orca`, compound identifiers and the real external Stably
# services (Orca Cloud/Relay/CLI) are all left verbatim.
src_out=$(python3 - "$HERE/apply.py" <<'PY'
import importlib.util, sys
s = importlib.util.spec_from_file_location('a', sys.argv[1])
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
rb = lambda t: m._SOURCE_TOKEN_RE.sub(m._rebrand_source_token, t)
cases = {
    "translate('auto.x','ORCA')": "translate('auto.x','PULSARIDE')",
    "translate('k','Orca logo')": "translate('k','PulsarIDE logo')",
    "setError('This Orca skill link.')": "setError('This PulsarIDE skill link.')",
    "// Distinct from prod's 'Orca'.": "// Distinct from prod's 'Orca'.",
    "const s='Orca Cloud'": "const s='Orca Cloud'",
    "label('Orca CLI')": "label('Orca CLI')",
    "x==='orca'": "x==='orca'",
    "`Welcome to Orca`": "`Welcome to PulsarIDE`",
    "name('OrcaThing')": "name('OrcaThing')",
}
bad = [(src, rb(src), want) for src, want in cases.items() if rb(src) != want]
print('OK' if not bad else 'FAIL ' + repr(bad[:3]))
PY
)
if echo "$src_out" | grep -q '^OK'; then
  ok "source-string rebrand (inline Orca -> PulsarIDE; comments/services/identifiers kept)"
else
  bad "source-string rebrand"; echo "$src_out" | head -3
fi

# 4a. the overlay adds to Orca; it must not take anything away.
python3 "$HERE/check-additive.py" > /tmp/planide-additive.log 2>&1 \
  && ok "no edit removes upstream code (branding constants aside)" \
  || { bad "an edit drops upstream code outside the branding files"; head -6 /tmp/planide-additive.log; }

# 4b. the surfaces lean on two things Orca defines, not us: its theme tokens and
# its `can-hover:` variant (which is what hides row actions until hover). If
# upstream drops the variant, our controls would be invisible on a desktop --
# silently. Check it exists rather than find out from a screenshot.
if [ -f "$CHECKOUT/src/renderer/src/assets/main.css" ]; then
  if grep -q "@custom-variant can-hover" "$CHECKOUT/src/renderer/src/assets/main.css"; then
    ok "Orca still defines the can-hover variant the surfaces use"
  else
    bad "Orca no longer defines @custom-variant can-hover (hover-reveal would break)"
  fi
else
  skip "can-hover variant check (no Orca checkout)"
fi

# 4c. the agent bundle deploy: the real module against a temp HOME (plain Node
# fs, no Electron). Proves 101 team leads reach Claude/Codex/Gemini, the 48
# curated skills incl. orchestration land, the graphify hook is wired per
# project, and the user's own agents/hooks are never touched.
if command -v npx >/dev/null 2>&1; then
  work=$(mktemp -d)
  if npx --yes esbuild "$HERE/overlay/src/main/planide/agent-bundle.ts" --bundle --platform=node \
       --format=cjs --outfile="$work/ab.cjs" --external:electron --log-level=error >/dev/null 2>&1; then
    out=$(PULSAR_REPO="$ROOT" PULSAR_BUNDLE_CJS="$work/ab.cjs" node "$HERE/test/agent-bundle.test.mjs" 2>&1)
    if echo "$out" | grep -q "FAIL=0"; then
      ok "agent bundle: $(echo "$out" | grep -oE 'PASS=[0-9]+') deploy checks"
    else
      bad "agent bundle deploy"; echo "$out" | grep "FAIL " | head -4
    fi
  else
    bad "agent bundle: test bundle failed to build"
  fi
  rm -rf "$work"
else
  skip "agent bundle deploy (npx unavailable)"
fi

# 4c-2. the tracker MCP server: driven over real MCP stdio frames, and checked
# against the IDE's own store so the two cannot drift. This is the server agents
# actually call -- it runs under the app binary, so it needs no Python.
if command -v npx >/dev/null 2>&1; then
  work=$(mktemp -d)
  if npx --yes esbuild "$HERE/overlay/src/main/planide/store.ts" --bundle --platform=node \
       --format=cjs --outfile="$work/store.cjs" --external:electron --log-level=error >/dev/null 2>&1; then
    out=$(PULSAR_REPO="$ROOT" PULSAR_STORE_CJS="$work/store.cjs" node "$HERE/test/mcp-node.test.mjs" 2>&1)
    if echo "$out" | grep -q "FAIL=0"; then
      ok "tracker MCP server: $(echo "$out" | grep -oE 'PASS=[0-9]+') protocol + parity checks"
    else
      bad "tracker MCP server"; echo "$out" | grep "FAIL " | head -4
    fi
  else
    bad "tracker MCP server: store bundle failed to build"
  fi
  rm -rf "$work"
else
  skip "tracker MCP server (npx unavailable)"
fi

# 4c1. pulsar-tools: the server the team leads already tell agents to call.
out=$(node "$HERE/test/pulsar-tools-mcp.test.mjs" 2>&1)
if echo "$out" | grep -q "FAIL=0"; then
  ok "pulsar-tools MCP: $(echo "$out" | grep -oE 'PASS=[0-9]+') protocol + routing checks"
else
  bad "pulsar-tools MCP"; echo "$out" | grep "FAIL " | head -4
fi

# 4c1b. What the bundled agents are TOLD to call must actually exist.
# A team lead that names a tool or a script we do not ship sends the agent to a
# guaranteed failure, which then gets recorded as a failed approach and starts
# blocking real work. council.md really did tell every agent to run
# ThePunisher-Agent's own scripts/verify.sh and a run_verify() tool that was
# never ported, in whatever project the user happened to be in.
missing_refs=$(grep -rnoE "run_verify\(\)|scripts/(verify|anti-loop)\.sh" \
  "$ROOT/ide/agent-bundle/agents" "$ROOT/ide/agent-bundle/specialists" 2>/dev/null || true)
if [ -z "$missing_refs" ]; then
  ok "bundled agents only name tooling that ships with them"
else
  bad "a bundled agent names tooling that does not ship: $(echo "$missing_refs" | head -1 | cut -c1-100)"
fi

# Every pulsar-tools tool a bundled agent names must be one the server offers.
tool_gap=$(python3 - "$ROOT" <<'PY_TOOLS'
import re, sys, pathlib
root = pathlib.Path(sys.argv[1])
server = (root / 'ide/agent-bundle/tracker/mcp/pulsar-tools-mcp.mjs').read_text(encoding='utf-8')
have = set(re.findall(r"name: '([a-z_]+)'", server))
named = set()
for d in ('ide/agent-bundle/agents', 'ide/agent-bundle/specialists'):
    for f in (root / d).rglob('*.md'):
        body = f.read_text(encoding='utf-8', errors='replace')
        for m in re.finditer(r'`(check_anti_loop|record_anti_loop_failure|clear_anti_loop|route_task|re_triage|run_verify|council_memory_overview)`', body):
            named.add(m.group(1))
print(','.join(sorted(named - have)))
PY_TOOLS
)
if [ -z "$tool_gap" ]; then
  ok "every pulsar-tools tool the agents name is one the server offers"
else
  bad "agents name pulsar-tools tools that do not exist: $tool_gap"
fi

# 4c2. the Brain Graph's rebuild path: the button that used to only re-read.
# Runs the real graphify when it is installed, and skips those checks when it
# is not -- a machine without it is a normal state, not a failure.
if command -v npx >/dev/null 2>&1; then
  work=$(mktemp -d)
  if npx --yes esbuild "$HERE/overlay/src/main/planide/graphify-run.ts" --bundle --platform=node \
       --format=cjs --outfile="$work/gr.cjs" --external:electron --log-level=error >/dev/null 2>&1; then
    out=$(PULSAR_GRAPHIFYRUN_CJS="$work/gr.cjs" node "$HERE/test/graphify-run.test.mjs" 2>&1)
    if echo "$out" | grep -q "FAIL=0"; then
      ok "graph rebuild: $(echo "$out" | grep -oE 'PASS=[0-9]+') checks"
    else
      bad "graph rebuild"; echo "$out" | grep "FAIL " | head -4
    fi
  else
    bad "graph rebuild: test bundle failed to build"
  fi
  rm -rf "$work"
else
  skip "graph rebuild (npx unavailable)"
fi

# 4c3. the theme: real WCAG contrast on every foreground/background pair, in
# BOTH blocks. A brand red is easy to get wrong -- #ff453a is a fine accent on
# near-black and 2.5:1 on white, which is unreadable as text.
out=$(node "$HERE/test/theme-contrast.test.mjs" 2>&1)
if echo "$out" | grep -q "FAIL=0"; then
  ok "theme contrast: $(echo "$out" | grep -oE 'PASS=[0-9]+') checks"
else
  bad "theme contrast"; echo "$out" | grep "FAIL " | head -4
fi

# 4d. per-project memory status: graphify graph + Obsidian note detection reads
# the same layout council-memory.py writes (same slug, same vault-resolution
# order), so the Tracker's Memory panel and the hook never disagree.
if command -v npx >/dev/null 2>&1; then
  work=$(mktemp -d)
  if npx --yes esbuild "$HERE/overlay/src/main/planide/memory-status.ts" --bundle --platform=node \
       --format=cjs --outfile="$work/ms.cjs" --external:electron --log-level=error >/dev/null 2>&1; then
    out=$(PULSAR_MEMSTATUS_CJS="$work/ms.cjs" node "$HERE/test/memory-status.test.mjs" 2>&1)
    if echo "$out" | grep -q "FAIL=0"; then
      ok "memory status: $(echo "$out" | grep -oE 'PASS=[0-9]+') checks"
    else
      bad "memory status"; echo "$out" | grep "FAIL " | head -4
    fi
  else
    bad "memory status: test bundle failed to build"
  fi
  rm -rf "$work"
else
  skip "memory status (npx unavailable)"
fi

# 4c1. Archify: the real module driving the real bundled archify, every type.
# Renders one diagram of each kind, because the bug that reached a user was a
# CLI flag that only architecture accepts -- a mocked CLI would have taken it.
if command -v npx >/dev/null 2>&1; then
  work=$(mktemp -d)
  if npx --yes esbuild "$HERE/overlay/src/main/planide/archify-run.ts" --bundle --platform=node \
      --format=cjs --outfile="$work/ar.cjs" --external:electron --log-level=error >/dev/null 2>&1; then
    out=$(PULSAR_ARCHIFYRUN_CJS="$work/ar.cjs" node "$HERE/test/archify-run.test.mjs" 2>&1)
    if echo "$out" | grep -q "FAIL=0"; then
      ok "archify: $(echo "$out" | grep -oE 'PASS=[0-9]+') render checks (every diagram type)"
    else
      bad "archify render"; echo "$out" | grep -A1 "FAIL " | head -6
    fi
  else
    bad "archify-run.ts does not bundle"
  fi
  rm -rf "$work"
else
  skip "archify render (needs npx)"
fi

# 4c. OpenDesign: the real module against a stand-in `od` on PATH.
if command -v npx >/dev/null 2>&1; then
  work=$(mktemp -d)
  if npx --yes esbuild "$HERE/overlay/src/main/planide/open-design.ts" --bundle --platform=node \
      --format=cjs --outfile="$work/od.cjs" >/dev/null 2>&1; then
    out=$(PULSAR_OPENDESIGN_CJS="$work/od.cjs" node "$HERE/test/open-design.test.mjs" 2>&1)
    if echo "$out" | grep -q "FAIL=0"; then
      ok "open design: $(echo "$out" | grep -oE 'PASS=[0-9]+') checks"
    else
      bad "open design"; echo "$out" | grep "FAIL " | head -4
    fi
  else
    bad "open design: test bundle failed to build"
  fi
  rm -rf "$work"
else
  skip "open design (npx unavailable)"
fi

# 5. the real test: does the overlay still apply to an Orca checkout?
if [ -f "$CHECKOUT/package.json" ]; then
  tmp=$(mktemp -d)
  # Copy just the files the overlay touches into a scratch tree, so the test is
  # fast and leaves the developer's own checkout untouched.
  PLANIDE_IDE_DIR="$HERE" python3 - "$tmp" "$CHECKOUT" <<'PY' >/dev/null 2>&1
import os, shutil, sys, importlib.util
dest, checkout = sys.argv[1], sys.argv[2]
here = os.environ['PLANIDE_IDE_DIR']
spec = importlib.util.spec_from_file_location('a', os.path.join(here, 'apply.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
files = {rel for rel, *_ in m.EDITS} | {'package.json'}
for rel in files:
    src = os.path.join(checkout, rel)
    if os.path.isfile(src):
        dst = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
PY
  # A checkout that build.sh already patched still passes -- but then some
  # anchors are ones our own earlier edits created, so say so rather than let a
  # green line imply "still applies to pristine upstream".
  note=""
  grep -q "planide" "$tmp/src/main/index.ts" 2>/dev/null && note=" [checkout was already patched]"
  result=$(python3 "$HERE/apply.py" "$tmp" 2>&1)
  if echo "$result" | grep -q "PROBLEMS"; then
    bad "overlay applies to the Orca checkout (upstream drifted)"
    echo "$result" | sed -n '/PROBLEMS/,$p' | head -8
  else
    applied=$(echo "$result" | grep -oE 'edits applied : [0-9]+' | grep -oE '[0-9]+')
    done_already=$(echo "$result" | grep -oE 'already done  : [0-9]+' | grep -oE '[0-9]+')
    ok "overlay applies to the Orca checkout ($((applied + done_already)) edits resolve)$note"
    # The agent hooks must be written and invoked at the SAME home directory.
    # We rename ~/.orca to ~/.pulsar so a real Orca install is not disturbed;
    # miss one half and the scripts land in one place while the agent CLI is
    # told to run the other, so the hook never fires and a busy agent shows as
    # a dead grey dot. That shipped once.
    hookmix=$(grep -rn "\.orca/agent-hooks\|\.orca\\\\agent-hooks" "$tmp/src" 2>/dev/null \
              | grep -v "\.test\." | grep -vE "^\s*[0-9]+:\s*(//|\*)" | head -3 || true)
    if [ -z "$hookmix" ]; then
      ok "agent hooks are written and invoked at the same home (~/.pulsar)"
    else
      bad "an agent-hook path still points at ~/.orca: $(echo "$hookmix" | head -1 | cut -c1-90)"
    fi

    # Nothing that feeds the auto-updater may point at Orca. A user whose
    # updater resolves an Orca release downloads and installs Orca OVER
    # PulsarIDE -- the worst way the two apps can mix.
    #
    # This checks every updater source file, not just the channel constants:
    # scoping it to release-channel.ts is exactly how two live fallbacks in
    # updater.ts shipped in v0.32.0 still pointing at stablyai/orca, which a
    # running build then logged on startup. Tests are excluded -- they assert
    # against upstream's own fixtures and are not shipped.
    stray=""
    for uf in "$tmp/src/shared/release-channel.ts" "$tmp"/src/main/updater*.ts; do
      case "$uf" in *.test.ts|*-test-harness.ts) continue ;; esac
      [ -f "$uf" ] || continue
      hit=$(grep -nE "stablyai/orca" "$uf" 2>/dev/null | grep -vE "^\s*[0-9]+:\s*(//|\*)" || true)
      [ -n "$hit" ] && stray="$stray $(basename "$uf"):$(echo "$hit" | head -1 | cut -d: -f1)"
    done
    if [ -z "$stray" ]; then
      feeds=$(grep -rhoE "ThePunisherai/PulsarIDE" "$tmp/src/shared/release-channel.ts" \
              "$tmp"/src/main/updater.ts "$tmp"/src/main/updater-prerelease-feed.ts 2>/dev/null | wc -l | tr -d ' ')
      ok "every updater feed ($feeds) resolves to PulsarIDE, not Orca"
    else
      bad "an updater feed still points at Orca:$stray"
    fi
    # re-run must be a no-op
    again=$(python3 "$HERE/apply.py" "$tmp" 2>&1 | grep -oE 'edits applied : [0-9]+' | grep -oE '[0-9]+')
    [ "$again" = "0" ] && ok "apply is idempotent (re-run changes nothing)" \
                       || bad "apply is not idempotent (re-applied $again edits)"
  fi
  rm -rf "$tmp"
else
  skip "apply-to-checkout (nothing at $CHECKOUT -- run ./ide/fetch-upstream.sh)"
fi

echo
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" = 0 ] && { echo "ALL GREEN"; exit 0; } || { echo "OVERLAY VERIFY FAILED"; exit 1; }
