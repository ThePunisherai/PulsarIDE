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
if python3 -m py_compile server.py planide/*.py mcp/planide_mcp.py 2>/tmp/planide-pyc.log; then
  ok "python: py_compile server.py + planide/*.py + mcp/planide_mcp.py"
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

  # CLI write commands = the agent tracking loop
  IT=$(PYTHONPATH="$DIR" python3 -m planide item add "$PROJ" "cli item" --status broken 2>/dev/null | grep -o 'i_[a-f0-9]*')
  [ -n "$IT" ] && ok "cli: item add" || bad "cli: item add"
  PYTHONPATH="$DIR" python3 -m planide item set "$PROJ" "$IT" --status works 2>/dev/null | grep -q 'works' \
    && ok "cli: item set (mark works)" || bad "cli: item set"
  FX=$(PYTHONPATH="$DIR" python3 -m planide fix add "$PROJ" "cli fix" --agent tester 2>/dev/null | grep -o 'f_[a-f0-9]*')
  PYTHONPATH="$DIR" python3 -m planide fix done "$PROJ" "$FX" 2>/dev/null | grep -q 'fixed' \
    && ok "cli: fix done" || bad "cli: fix done"

  # --- the confirmation trust boundary -------------------------------------
  # An agent reporting "works" is a CLAIM; only the user confirms.
  CI=$(PYTHONPATH="$DIR" python3 -m planide item add "$PROJ" "agent claim" \
       --status works --agent TestBot 2>/dev/null | grep -o 'i_[a-f0-9]*')
  curl -fs "http://127.0.0.1:$PORT/api/project?id=$PIDV" \
    | python3 -c "
import sys,json; d=json.load(sys.stdin)
it=[i for i in d['items'] if i['id']=='$CI'][0]
sys.exit(0 if (it['status']=='works' and it['verified'] is False
               and it['claimed_by']=='TestBot') else 1)" \
    && ok "trust: an agent's 'works' is a claim, not confirmed" \
    || bad "trust: agent claim was treated as confirmed"

  # The engine must expose no way for that same call to self-confirm.
  curl -fs -X POST "http://127.0.0.1:$PORT/api/item/update" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$PIDV\",\"item_id\":\"$CI\",\"verified\":true}" >/dev/null 2>&1
  curl -fs "http://127.0.0.1:$PORT/api/project?id=$PIDV" \
    | python3 -c "
import sys,json; d=json.load(sys.stdin)
it=[i for i in d['items'] if i['id']=='$CI'][0]
sys.exit(0 if it['verified'] is False else 1)" \
    && ok "trust: item/update cannot set verified (agents cannot self-confirm)" \
    || bad "trust: item/update let a caller confirm its own work"

  # The user's own confirmation does work.
  curl -fs -X POST "http://127.0.0.1:$PORT/api/item/verify" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$PIDV\",\"item_id\":\"$CI\",\"verified\":true}" | grep -q '"verified": true' \
    && ok "trust: /api/item/verify confirms (the user's own path)" \
    || bad "trust: /api/item/verify did not confirm"

  # Re-reporting a different status must drop a confirmation, never keep it.
  curl -fs -X POST "http://127.0.0.1:$PORT/api/item/update" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$PIDV\",\"item_id\":\"$CI\",\"status\":\"broken\"}" >/dev/null 2>&1
  curl -fs "http://127.0.0.1:$PORT/api/project?id=$PIDV" \
    | python3 -c "
import sys,json; d=json.load(sys.stdin)
it=[i for i in d['items'] if i['id']=='$CI'][0]
sys.exit(0 if it['verified'] is False else 1)" \
    && ok "trust: a status change invalidates your confirmation" \
    || bad "trust: confirmation survived a status change"

  # progress() must report claimed and confirmed as separate numbers.
  curl -fs "http://127.0.0.1:$PORT/api/project?id=$PIDV" \
    | python3 -c "
import sys,json; p=json.load(sys.stdin)['progress']
sys.exit(0 if all(k in p for k in ('confirmed','unconfirmed','confirmed_percent')) else 1)" \
    && ok "trust: progress separates claimed from confirmed" \
    || bad "trust: progress is missing the confirmed split"
fi

# The MCP surface agents use must expose no confirmation tool at all.
FAKE2=$(mktemp -d); mkdir -p "$FAKE2/mcp/server"
: > "$FAKE2/mcp/__init__.py"; : > "$FAKE2/mcp/server/__init__.py"
printf 'class FastMCP:\n    def __init__(self,n): self.tools=[]\n    def tool(self):\n        def d(f): self.tools.append(f.__name__); return f\n        return d\n    def run(self): pass\n' > "$FAKE2/mcp/server/fastmcp.py"
if PYTHONPATH="$FAKE2" python3 -c "
import importlib.util
s=importlib.util.spec_from_file_location('m','mcp/planide_mcp.py')
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
bad=[t for t in m.mcp.tools if 'verif' in t or 'confirm' in t]
assert not bad, bad
" 2>/dev/null; then ok "trust: MCP exposes no verify/confirm tool to agents"; else bad "trust: MCP exposes a confirm tool"; fi
rm -rf "$FAKE2"

# MCP server: graceful degradation + no shadow from this repo's own mcp/ dir
# (capture first -- the server exits 1 when 'mcp' is absent, which pipefail
#  would otherwise propagate through the grep pipe as a false failure)
MCPMSG=$(python3 mcp/planide_mcp.py 2>&1 || true)
echo "$MCPMSG" | grep -q "pip install mcp" \
  && ok "mcp: graceful message when 'mcp' absent" || bad "mcp: graceful message"
FAKE=$(mktemp -d); mkdir -p "$FAKE/mcp/server"
: > "$FAKE/mcp/__init__.py"; : > "$FAKE/mcp/server/__init__.py"
printf 'class FastMCP:\n    def __init__(self,n): pass\n    def tool(self):\n        def d(f): return f\n        return d\n    def run(self): pass\n' > "$FAKE/mcp/server/fastmcp.py"
if PYTHONPATH="$FAKE" python3 -c "
import importlib.util
s=importlib.util.spec_from_file_location('m','mcp/planide_mcp.py')
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
assert m.FastMCP.__module__=='mcp.server.fastmcp', m.FastMCP.__module__
assert callable(m.list_projects) and callable(m.mark_fixed) and callable(m.set_item)
" 2>/tmp/planide-mcp.log; then ok "mcp: real SDK resolves (not shadowed); tools load"; else bad "mcp: import ($(cat /tmp/planide-mcp.log))"; fi
rm -rf "$FAKE"

kill "$SRV" 2>/dev/null
rm -rf "$TESTCFG" "$PROJ"

echo
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" = 0 ]; then echo "ALL GREEN"; exit 0; else echo "SELF-TEST FAILED"; exit 1; fi
