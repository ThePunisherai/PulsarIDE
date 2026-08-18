#!/usr/bin/env bash
# Start / stop / status the PlanIDE web server as a background process.
#   ./start.sh            start (background), print the URL
#   ./start.sh --status   is it running?
#   ./start.sh --stop     stop it
#   ./start.sh --fg       run in the foreground
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PLANIDE_PORT:-8390}"
PIDFILE="${DIR}/.planide-server.pid"
URL="http://127.0.0.1:${PORT}"

alive() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop() {
  if alive; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    sleep 1
    echo "stopped."
  else
    echo "not running."
  fi
  rm -f "$PIDFILE"
}

case "${1:-start}" in
  --status)
    if alive; then echo "running (pid $(cat "$PIDFILE")) -> ${URL}"; else echo "not running"; fi
    ;;
  --stop)
    stop
    ;;
  --fg)
    exec python3 "${DIR}/server.py"
    ;;
  start|"")
    if alive; then echo "already running -> ${URL}"; exit 0; fi
    PLANIDE_OPEN=0 nohup python3 "${DIR}/server.py" --no-browser >"${DIR}/.planide-server.log" 2>&1 &
    echo "$!" > "$PIDFILE"
    sleep 1
    if alive; then echo "PlanIDE started -> ${URL}"; else echo "failed to start (see .planide-server.log)"; exit 1; fi
    ;;
  *)
    echo "usage: ./start.sh [--status|--stop|--fg]"; exit 2;;
esac
