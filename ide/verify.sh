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
  out=$(cd "$HERE/overlay" && "${TSC[@]}" --noEmit --noResolve \
        --jsx react-jsx --target es2022 --module esnext --moduleResolution bundler --skipLibCheck \
        src/preload/planide.ts \
        src/main/planide/store.ts src/main/planide/detect.ts \
        src/main/planide/report.ts src/main/planide/git.ts \
        src/main/planide/backup.ts src/main/planide/ipc.ts \
        src/main/planide/agent-events.ts src/main/planide/agent-bundle.ts \
        src/main/planide/memory-sync.ts src/main/planide/auto-push.ts \
        src/renderer/src/components/right-sidebar/planide-engine-client.ts \
        src/renderer/src/components/right-sidebar/PlanIdePanel.tsx \
        src/renderer/src/components/planide/PlanIdeView.tsx \
        src/renderer/src/components/planide/PlanIdeMark.tsx \
        src/renderer/src/components/planide/PlanIdeSync.tsx \
        src/renderer/src/components/planide/PlanIdeBackups.tsx 2>&1 \
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
  skip "apply-to-checkout (nothing at $CHECKOUT -- run ./ide/fetch-upstream.sh)"
fi

echo
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" = 0 ] && { echo "ALL GREEN"; exit 0; } || { echo "OVERLAY VERIFY FAILED"; exit 1; }
