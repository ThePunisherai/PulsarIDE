#!/usr/bin/env bash
# Self-test for the PlanIDE agent tools (CLI + MCP server).
#
# These write each project's own .planide/state.json directly -- no server, no
# UI. The same file is read and written by the tracker inside the IDE, so the
# last section checks the two implementations actually agree on the format.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

PASS=0; FAIL=0
ok()  { echo "  PASS $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; FAIL=$((FAIL+1)); }

echo "== PlanIDE agent tools verify =="

python3 -m py_compile planide/*.py mcp/planide_mcp.py 2>/tmp/planide-pyc.log \
  && ok "python: py_compile" || bad "python: py_compile ($(cat /tmp/planide-pyc.log))"
python3 -c 'import planide, planide.store, planide.detect, planide.gitsync, planide.backup, planide.aireport' 2>/dev/null \
  && ok "python: package imports" || bad "python: package imports"
bash -n plan 2>/dev/null && ok "shell: plan parses" || bad "shell: plan parses"

TESTCFG="$(mktemp -d)"; export XDG_CONFIG_HOME="$TESTCFG"
PROJ="$(mktemp -d)"; echo '{"dependencies":{"react":"18"}}' > "$PROJ/package.json"
P="python3 -m planide"

# --- the agent loop ------------------------------------------------------- #
$P add "$PROJ" vtest >/dev/null 2>&1 \
  && ok "cli: add registers a project" || bad "cli: add"
$P detect "$PROJ" 2>/dev/null | grep -q "type:" \
  && ok "cli: detect" || bad "cli: detect"

IT=$($P item add "$PROJ" "agent claim" --status works --agent TestBot 2>/dev/null | grep -o 'i_[a-f0-9]*')
[ -n "$IT" ] && ok "cli: item add" || bad "cli: item add"

# --- the trust boundary --------------------------------------------------- #
# An agent reporting "works" is a CLAIM. Only the user confirms, and no
# agent-facing surface may set `verified` or `locked`.
python3 -c "
import sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$PROJ')
it = [i for i in st['items'] if i['id']=='$IT'][0]
sys.exit(0 if (it['status']=='works' and it['verified'] is False and it['claimed_by']=='TestBot') else 1)" \
  && ok "trust: an agent's 'works' is a claim, not confirmed" \
  || bad "trust: agent claim was treated as confirmed"

python3 -c "
import sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$PROJ')
store.update_item(st, '$IT', verified=True, locked=True)
store.save_state('$PROJ', st)
it = [i for i in store.load_state('$PROJ')['items'] if i['id']=='$IT'][0]
sys.exit(0 if (it['verified'] is False and it['locked'] is False) else 1)" \
  && ok "trust: update_item cannot set verified/locked" \
  || bad "trust: update_item let a caller set its own flags"

$P item confirm "$PROJ" "$IT" 2>/dev/null | grep -q "CONFIRMED" \
  && ok "trust: item confirm is the user's own path" || bad "trust: item confirm"
$P item lock "$PROJ" "$IT" 2>/dev/null | grep -q "PROTECTED" \
  && ok "protect: item lock marks do-not-break" || bad "protect: item lock"

$P item set "$PROJ" "$IT" --status broken --agent TestBot >/dev/null 2>&1
python3 -c "
import sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$PROJ')
it = [i for i in st['items'] if i['id']=='$IT'][0]
pr = store.progress(st)
sys.exit(0 if (it['verified'] is False and it['locked'] is True
               and pr['regressed'] >= 1 and len(store.regressions(st)) >= 1) else 1)" \
  && ok "protect: breaking protected work regresses and drops confirmation" \
  || bad "protect: regression not raised"

$P report "$PROJ" 2>/dev/null | grep -q "DO NOT BREAK" \
  && ok "briefing: carries the DO-NOT-BREAK list" || bad "briefing: missing protection"
$P activity "$PROJ" 2>/dev/null | grep -q "TestBot" \
  && ok "activity: changes are attributed to the agent" || bad "activity: attribution"

FX=$($P fix add "$PROJ" "cli fix" --agent TestBot 2>/dev/null | grep -o 'f_[a-f0-9]*')
$P fix done "$PROJ" "$FX" 2>/dev/null | grep -q "fixed" \
  && ok "cli: fix add + done" || bad "cli: fix add/done"

# --- MCP surface ----------------------------------------------------------- #
# Capture first: the server exits 1 when 'mcp' is absent, which pipefail would
# otherwise propagate through the grep as a false failure.
MCPMSG=$(python3 mcp/planide_mcp.py 2>&1 || true)
echo "$MCPMSG" | grep -q "pip install mcp" \
  && ok "mcp: graceful message when 'mcp' is absent" || bad "mcp: graceful message"

FAKE=$(mktemp -d); mkdir -p "$FAKE/mcp/server"
: > "$FAKE/mcp/__init__.py"; : > "$FAKE/mcp/server/__init__.py"
printf 'class FastMCP:\n    def __init__(self,n): self.tools=[]\n    def tool(self):\n        def d(f): self.tools.append(f.__name__); return f\n        return d\n    def run(self): pass\n' > "$FAKE/mcp/server/fastmcp.py"
PYTHONPATH="$FAKE" python3 -c "
import importlib.util
s = importlib.util.spec_from_file_location('m','mcp/planide_mcp.py')
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
assert m.FastMCP.__module__ == 'mcp.server.fastmcp', m.FastMCP.__module__
bad = [t for t in m.mcp.tools if 'verif' in t or 'confirm' in t or 'lock' in t or 'protect' in t]
assert not bad, bad
" 2>/dev/null \
  && ok "mcp: loads, and exposes no confirm/protect tool to agents" \
  || bad "mcp: import or trust-boundary problem"
rm -rf "$FAKE"

# --- the format contract with the IDE -------------------------------------- #
# The tracker inside the IDE is TypeScript; these tools are Python. They share
# one file, so a state written by either must be readable by the other.
IDE_TEST="$DIR/../ide/test/state-compat.mjs"
if [ -f "$IDE_TEST" ] && command -v node >/dev/null 2>&1; then
  if node "$IDE_TEST" "$PROJ" >/tmp/planide-compat.log 2>&1; then
    ok "contract: the IDE's tracker reads a state written by these tools"
  else
    bad "contract: IDE/agent-tools state format diverged"
    head -6 /tmp/planide-compat.log
  fi
else
  echo "  SKIP contract check (needs node + ide/test/state-compat.mjs)"
fi

rm -rf "$TESTCFG" "$PROJ"
echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] && { echo "ALL GREEN"; exit 0; } || { echo "SELF-TEST FAILED"; exit 1; }
