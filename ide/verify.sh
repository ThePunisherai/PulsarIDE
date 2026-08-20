#!/usr/bin/env bash
# PlanIDE IDE-overlay self-test.
#
# Verifies the overlay is well-formed and still applies cleanly to a real Orca
# checkout -- the thing that actually breaks when upstream moves. Skips the
# apply test (rather than failing) when no checkout is present, so it stays
# useful on a machine that has not run ide/build.sh yet.
#
#   ./ide/verify.sh                 # use ide/.work/orca if it exists
#   ./ide/verify.sh <orca-path>     # verify against a specific checkout
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CHECKOUT="${1:-$HERE/.work/orca}"

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

# 3. TypeScript in the overlay is syntactically valid
if command -v npx >/dev/null 2>&1; then
  # --noResolve keeps this dependency-free, at the cost of two known false
  # positives that only appear because React's types are not loaded:
  #   * "Property 'key' does not exist"  -- `key` is a real React prop
  #   * "implicitly has an 'any' type"   -- callback params typed via React
  # Both were confirmed clean in a separate run against real @types/react.
  # Everything else here is a genuine error.
  out=$(cd "$HERE/overlay" && npx --yes tsc --ignoreConfig --noEmit --noResolve \
        --jsx react-jsx --target es2022 --module esnext --moduleResolution bundler --skipLibCheck \
        src/preload/planide.ts \
        src/main/planide/store.ts src/main/planide/detect.ts \
        src/main/planide/report.ts src/main/planide/git.ts \
        src/main/planide/backup.ts src/main/planide/ipc.ts \
        src/main/planide/agent-events.ts \
        src/renderer/src/components/right-sidebar/planide-engine-client.ts \
        src/renderer/src/components/right-sidebar/PlanIdePanel.tsx \
        src/renderer/src/components/planide/PlanIdeView.tsx \
        src/renderer/src/components/planide/PlanIdeMark.tsx 2>&1 \
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
    # re-run must be a no-op
    again=$(python3 "$HERE/apply.py" "$tmp" 2>&1 | grep -oE 'edits applied : [0-9]+' | grep -oE '[0-9]+')
    [ "$again" = "0" ] && ok "apply is idempotent (re-run changes nothing)" \
                       || bad "apply is not idempotent (re-applied $again edits)"
  fi
  rm -rf "$tmp"
else
  skip "apply-to-checkout (no Orca checkout at $CHECKOUT -- run ./ide/build.sh)"
fi

echo
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" = 0 ] && { echo "ALL GREEN"; exit 0; } || { echo "OVERLAY VERIFY FAILED"; exit 1; }
