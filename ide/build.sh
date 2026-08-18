#!/usr/bin/env bash
# Build PlanIDE: clone Orca (MIT), apply the PlanIDE overlay, install, run.
#
#   ./ide/build.sh              # clone + apply + pnpm install, then tell you how to run
#   ./ide/build.sh --run        # ...and start the IDE in dev mode
#   ./ide/build.sh --apply-only # re-apply the overlay to an existing checkout
#   ./ide/build.sh --latest     # use upstream HEAD instead of the pinned commit
#
# The checkout lands in ide/.work/orca (gitignored). Your own code stays in
# ide/overlay/** — this script never edits it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WORK="$HERE/.work/orca"
UPSTREAM="https://github.com/stablyai/orca.git"
PINNED="$(grep -oE '^PINNED_COMMIT = "[a-f0-9]+"' "$HERE/apply.py" | grep -oE '[a-f0-9]{40}')"

RUN=0; APPLY_ONLY=0; USE_LATEST=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --apply-only) APPLY_ONLY=1 ;;
    --latest) USE_LATEST=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg"; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "!! missing: $1 ($2)"; exit 1; }; }
need git "install git"
need python3 "the tracker engine runs on python3"
[ "$APPLY_ONLY" = 1 ] || need pnpm "Orca builds with pnpm -- https://pnpm.io"

# ── 1. get the upstream checkout ──────────────────────────────────────────
if [ ! -d "$WORK/.git" ]; then
  echo "==> cloning Orca into ide/.work/orca"
  mkdir -p "$(dirname "$WORK")"
  git clone "$UPSTREAM" "$WORK"
fi

if [ "$USE_LATEST" = 1 ]; then
  echo "==> using upstream HEAD (not the pinned revision)"
  git -C "$WORK" fetch --all --quiet
  git -C "$WORK" checkout --quiet -
else
  echo "==> checking out pinned revision ${PINNED:0:12}"
  git -C "$WORK" fetch --quiet origin "$PINNED" 2>/dev/null || git -C "$WORK" fetch --quiet --all
  git -C "$WORK" checkout --quiet "$PINNED"
fi

# ── 2. apply the PlanIDE overlay ──────────────────────────────────────────
echo "==> applying the PlanIDE overlay"
python3 "$HERE/apply.py" "$WORK"

# ── 3. make the tracker engine reachable from the checkout ────────────────
# The main process looks for `tracker/` next to the app; symlink it so a dev run
# uses this repo's engine directly (packaged builds get a real copy via
# electron-builder extraResources).
if [ ! -e "$WORK/tracker" ]; then
  ln -s "$ROOT/tracker" "$WORK/tracker"
  echo "==> linked tracker/ -> $ROOT/tracker"
fi

if [ "$APPLY_ONLY" = 1 ]; then
  echo "==> overlay applied (--apply-only, skipping install)"
  exit 0
fi

# ── 4. install + run ──────────────────────────────────────────────────────
echo "==> pnpm install (this takes a while the first time)"
( cd "$WORK" && pnpm install )

if [ "$RUN" = 1 ]; then
  echo "==> starting PlanIDE"
  ( cd "$WORK" && pnpm dev )
else
  cat <<EOF

PlanIDE is ready.

  run in dev :  cd ide/.work/orca && pnpm dev
  package    :  cd ide/.work/orca && pnpm build && pnpm exec electron-builder --config config/electron-builder.config.cjs

The tracker sits in the right sidebar behind the radar icon.
EOF
fi
