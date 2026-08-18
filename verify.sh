#!/usr/bin/env bash
# PlanIDE full self-test: the tracker engine + the IDE overlay.
#
#   ./verify.sh
#
# Runs tracker/scripts/verify.sh (engine, API, CLI, MCP -- 25 checks) and
# ide/verify.sh (overlay integrity + does it still apply to Orca).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "######## tracker engine ########"
( cd "$ROOT/tracker" && ./scripts/verify.sh )
tracker_rc=$?

echo
echo "######## IDE overlay ########"
"$ROOT/ide/verify.sh"
ide_rc=$?

echo
if [ "$tracker_rc" = 0 ] && [ "$ide_rc" = 0 ]; then
  echo "PlanIDE: ALL GREEN"
  exit 0
fi
echo "PlanIDE: FAILED (tracker=$tracker_rc ide=$ide_rc)"
exit 1
