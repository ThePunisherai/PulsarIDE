#!/usr/bin/env bash
# PlanIDE self-test. Compiles the Python, syntax-checks the JS (if node is
# present), boots the server on a throwaway port with an isolated config dir,
# and exercises the real API + CLI end to end. Prints ALL GREEN on success.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

PASS=0; FAIL=0
ok()   { echo "  PASS $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL $1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }

echo "== PlanIDE verify =="

# 1. python compiles
if python3 -m py_compile server.py planide/*.py 2>/tmp/planide-pyc.log; then
  ok "python: py_compile server.py + planide/*.py"
else
  bad "python: py_compile ($(cat /tmp/planide-pyc.log))"
fi

# 2. package imports
check "python: import planide package" "python3 -c 'import planide, planide.store, planide.detect, planide.gitsync, planide.backup, planide.aireport'"

# 3. json / svg well-formed
check "static: index.html present"  "test -f static/index.html"
check "static: app.js present"      "test -f static/app.js"
check "static: style.css present"   "test -f static/style.css"
check "static: icon.svg parses"     "python3 -c 'import xml.dom.minidom as m; m.parse(\"static/icon.svg\")'"
check "static: favicon.svg parses"  "python3 -c 'import xml.dom.minidom as m; m.parse(\"static/favicon.svg\")'"

# 4. js syntax (node optional)
if command -v node >/dev/null 2>&1; then
  check "js: node --check app.js" "node --check static/app.js"
else
  echo "  SKIP js: node not installed"
fi

# 5. shell scripts parse
check "shell: start.sh parses" "bash -n start.sh"
check "shell: plan parses"     "bash -n plan"

# 6. end-to-end: boot server on a random port with an isolated config
TESTCFG="$(mktemp -d)"; export XDG_CONFIG_HOME="$TESTCFG"
PROJ="$(mktemp -d)"; echo '{"dependencies":{"react":"18"}}' > "$PROJ/package.json"
PORT=$(( (RANDOM % 2000) + 8600 ))
PLANIDE_PORT="$PORT" PLANIDE_OPEN=0 python3 server.py --no-browser >"$TESTCFG/srv.log" 2>&1 &
SRV=$!
# wait for it
up=0
for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$PORT/api/overview" >/dev/null 2>&1; then up=1; break; fi
  sleep 0.2
done
if [ "$up" = 1 ]; then ok "server: boots + /api/overview responds"; else bad "server: did not come up"; fi

if [ "$up" = 1 ]; then
  # add a project
  ADD=$(curl -fs -X POST "http://127.0.0.1:$PORT/api/project/add" \
        -H 'Content-Type: application/json' -d "{\"path\":\"$PROJ\",\"name\":\"vtest\"}")
  echo "$ADD" | grep -q '"ok": true' && ok "api: project/add" || bad "api: project/add ($ADD)"
  PIDV=$(echo "$ADD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["project"]["id"])' 2>/dev/null)

  # detect
  curl -fs "http://127.0.0.1:$PORT/api/detect?path=$PROJ" | grep -q '"type"' \
    && ok "api: detect" || bad "api: detect"

  # add an item + a fix
  curl -fs -X POST "http://127.0.0.1:$PORT/api/item/add" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$PIDV\",\"title\":\"login\",\"status\":\"broken\",\"notes\":\"500\"}" | grep -q '"ok": true' \
    && ok "api: item/add" || bad "api: item/add"
  curl -fs -X POST "http://127.0.0.1:$PORT/api/fix/add" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$PIDV\",\"title\":\"fix login\",\"problem\":\"db\",\"status\":\"open\"}" | grep -q '"ok": true' \
    && ok "api: fix/add" || bad "api: fix/add"

  # ai report reflects the broken item
  curl -fs "http://127.0.0.1:$PORT/api/ai-report?id=$PIDV" | grep -q 'What is broken' \
    && ok "api: ai-report" || bad "api: ai-report"

  # backup
  curl -fs -X POST "http://127.0.0.1:$PORT/api/backup/create" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$PIDV\"}" | grep -q '"ok": true' && ok "api: backup/create" || bad "api: backup/create"

  # CSRF: a cross-origin POST must be refused
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/item/add" \
    -H 'Content-Type: application/json' -H 'Origin: http://evil.example' \
    -d "{\"id\":\"$PIDV\",\"title\":\"x\"}")
  [ "$code" = "403" ] && ok "security: cross-origin POST refused (403)" || bad "security: CSRF not blocked ($code)"

  # CLI
  PYTHONPATH="$DIR" python3 -m planide list 2>/dev/null | grep -q "$PIDV" \
    && ok "cli: list shows project" || bad "cli: list"
  PYTHONPATH="$DIR" python3 -m planide report "$PIDV" 2>/dev/null | grep -q 'project briefing' \
    && ok "cli: report" || bad "cli: report"
fi

kill "$SRV" 2>/dev/null
rm -rf "$TESTCFG" "$PROJ"

echo
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" = 0 ]; then echo "ALL GREEN"; exit 0; else echo "SELF-TEST FAILED"; exit 1; fi
