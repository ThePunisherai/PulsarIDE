#!/usr/bin/env bash
# Fetch the upstream files the overlay touches, at the pinned revision.
#
#   ./ide/fetch-upstream.sh
#
# Why not just use ide/.work/orca: build.sh applies the overlay to that checkout,
# so testing "does the overlay still apply?" against it can pass on anchors our
# own earlier run created. This pulls the handful of files pristine (a few
# hundred KB, no clone) into ide/.work/pristine, and ide/verify.sh prefers it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/.work/pristine"
PIN="$(grep -oE '^PINNED_COMMIT = "[a-f0-9]+"' "$HERE/apply.py" | grep -oE '[a-f0-9]{40}')"
RAW="https://raw.githubusercontent.com/stablyai/orca/$PIN"

files=$(python3 - "$HERE" <<'PY'
import importlib.util, os, sys
here = sys.argv[1]
spec = importlib.util.spec_from_file_location('a', os.path.join(here, 'apply.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print('\n'.join(sorted({rel for rel, *_ in m.EDITS} | {'package.json'})))
PY
)

# Files the suite reads but never edits: the stylesheet whose tokens and
# can-hover variant the tracker surfaces are built on.
files="$files
src/renderer/src/assets/main.css"

mkdir -p "$DEST"
echo "==> fetching ${PIN:0:12} into ide/.work/pristine"
for rel in $files; do
  mkdir -p "$DEST/$(dirname "$rel")"
  if ! curl -fsS --max-time 60 -o "$DEST/$rel" "$RAW/$rel"; then
    echo "!! could not fetch $rel"; exit 1
  fi
done
echo "==> $(echo "$files" | wc -l) files"
