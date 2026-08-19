#!/usr/bin/env bash
# PlanIDE full self-test: the tracker engine + the IDE overlay.
#
#   ./verify.sh
#
# Runs agent-tools/scripts/verify.sh (the CLI + MCP agents use) and
# ide/verify.sh (the tracker itself, the overlay, and whether it still applies
# to upstream Orca).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "######## agent tools (CLI + MCP) ########"
( cd "$ROOT/agent-tools" && ./scripts/verify.sh )
tracker_rc=$?

echo
echo "######## the IDE (tracker + overlay) ########"
"$ROOT/ide/verify.sh"
ide_rc=$?

echo
if [ "$tracker_rc" = 0 ] && [ "$ide_rc" = 0 ]; then
  echo "PlanIDE: ALL GREEN"
  exit 0
fi
echo "PlanIDE: FAILED (tracker=$tracker_rc ide=$ide_rc)"
exit 1
