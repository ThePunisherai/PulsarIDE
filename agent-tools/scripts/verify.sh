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
sys.exit(0 if (it['status']=='done' and it['verified'] is False and it['claimed_by']=='TestBot'
               and store.progress(st)['confirmed']==0) else 1)" \
  && ok "trust: an agent's 'works' lands as done (auto-complete), never as your confirmation" \
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

# --- auto-complete, the fix log, and the work order ----------------------- #
# The same rules the MCP server and the IDE apply, for a shell-only agent.
P2="$(mktemp -d)"; mkdir -p "$P2/.git"
$P settings "$P2" --auto-complete off 2>/dev/null | grep -q "off" \
  && ok "settings: auto-complete can be switched off by you" || bad "settings: switch off"
OFFIT=$($P item add "$P2" "off works" --status works --agent TestBot 2>/dev/null | grep -o 'i_[a-f0-9]*')
python3 -c "
import sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$P2')
it = [i for i in st['items'] if i['id']=='$OFFIT'][0]
pr = store.progress(st)
sys.exit(0 if it['status']=='works' and pr['accepted']==0 and pr['unconfirmed']==1 else 1)" \
  && ok "auto-complete off: agent works stays works and counts as a claim" || bad "auto-complete off"
$P settings "$P2" --auto-complete on 2>/dev/null | grep -q "on" \
  && python3 -c "
import sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$P2')
it = [i for i in st['items'] if i['id']=='$OFFIT'][0]
pr = store.progress(st)
sys.exit(0 if it['status']=='done' and pr['accepted']==1 and pr['unconfirmed']==0 and pr['confirmed']==0 else 1)" \
  && ok "auto-complete on: switching it on closes out what works, no hand needed" || bad "auto-complete on"

# The autopilot switch: yours, separate from auto-complete, read the same everywhere.
$P settings "$P2" --autopilot off 2>/dev/null | grep -q "autopilot: off" \
  && python3 -c "
import sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$P2')
sys.exit(0 if st['settings'].get('autopilot') is False and store.auto_complete(st) and not store.progress(st)['autopilot'] else 1)" \
  && ok "settings: autopilot can be switched off by you, auto-complete untouched" || bad "settings: autopilot off"
$P settings "$P2" --autopilot on >/dev/null 2>&1

F1=$($P fix add "$P2" "Login crash" --problem "auth.py:12" --agent TestBot 2>/dev/null)
F2=$($P fix add "$P2" "login crash!" --problem "also on Safari" --agent TestBot 2>/dev/null)
echo "$F2" | grep -q "already open" && python3 -c "
import sys; sys.path.insert(0,'.')
from planide import store
fx = store.load_state('$P2')['fixes']
sys.exit(0 if len(fx)==1 and fx[0]['problem']=='auth.py:12\nalso on Safari' and 'existing' not in fx[0] else 1)" \
  && ok "fix log: the same open bug is one entry, the new detail kept on it" || bad "fix log: duplicate entry"

$P item add "$P2" "Half done" --status wip --agent claude >/dev/null 2>&1
$P item add "$P2" "Next todo" >/dev/null 2>&1
$P next "$P2" 2>/dev/null | grep -q "FINISH FIRST.*Half done" \
  && ok "next: in-progress work comes first" || bad "next: order"
$P item set "$P2" "$($P next "$P2" --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["focus"]["id"])')" --status works --agent claude >/dev/null 2>&1
CLAIM=$($P next "$P2" --agent codex --claim --json 2>/dev/null)
echo "$CLAIM" | python3 -c "
import json, sys
q = json.load(sys.stdin)
sys.exit(0 if q['claimed'] and q['claimed']['title']=='Next todo' and q['claimed']['to']=='wip'
         and q['focus']['title']=='Next todo' else 1)" \
  && ok "next --claim: with wip finished, the next todo is started under the agent's name" || bad "next --claim"

# Byte-for-byte the same queue as the MCP server's next_task, on the same board
# and clock -- three implementations of one order must not drift.
QUEUE_MJS="$DIR/../ide/agent-bundle/tracker/mcp/work-queue.mjs"
if [ -f "$QUEUE_MJS" ] && command -v node >/dev/null 2>&1; then
  NOW_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
  py_q=$(python3 -c "
import json, sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$P2')
for agent in ('', 'codex', 'claude'):
    print(json.dumps(store.work_queue(st, agent, now_ms=$NOW_MS), ensure_ascii=False, separators=(',', ':')))")
  js_q=$(node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { workQueue } = await import(pathToFileURL('$QUEUE_MJS').href)
const st = JSON.parse(readFileSync('$P2/.planide/state.json', 'utf8'))
for (const agent of ['', 'codex', 'claude']) console.log(JSON.stringify(workQueue(st, { agent, now: $NOW_MS })))")
  [ -n "$py_q" ] && [ "$py_q" = "$js_q" ] \
    && ok "parity: plan next and the MCP next_task return the identical queue" \
    || { bad "parity: plan next and next_task disagree"; echo "    py: ${py_q:0:200}"; echo "    js: ${js_q:0:200}"; }
  # ...and on an item with a checklist another chat left, with and without the
  # user's "ga door" (resume): the step counts, the step to carry on at, the list.
  python3 -c "
import json
p = '$P2/.planide/state.json'
st = json.load(open(p))
for it in st['items']:
    if it['status'] == 'wip':
        it['steps'] = [{'title': 'First step', 'status': 'done'}, {'title': 'Second step', 'status': 'wip'},
                       {'title': 'Third step', 'status': 'todo'}]
        it['claimed_by'] = 'gemini'
json.dump(st, open(p, 'w'))"
  py_r=$(python3 -c "
import json, sys; sys.path.insert(0,'.')
from planide import store
st = store.load_state('$P2')
for agent in ('', 'codex', 'claude'):
    for resume in (False, True):
        print(json.dumps(store.work_queue(st, agent, now_ms=$NOW_MS, resume=resume), ensure_ascii=False, separators=(',', ':')))")
  js_r=$(node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { workQueue } = await import(pathToFileURL('$QUEUE_MJS').href)
const st = JSON.parse(readFileSync('$P2/.planide/state.json', 'utf8'))
for (const agent of ['', 'codex', 'claude']) for (const resume of [false, true]) console.log(JSON.stringify(workQueue(st, { agent, now: $NOW_MS, resume })))")
  [ -n "$py_r" ] && [ "$py_r" = "$js_r" ] && echo "$py_r" | grep -q '"next_step":"Second step"' \
    && ok "parity: a checklist and the user's resume read the same in plan next and next_task" \
    || { bad "parity: checklist / resume differ"; echo "    py: ${py_r:0:300}"; echo "    js: ${js_r:0:300}"; }
else
  echo "  SKIP queue parity (needs node + work-queue.mjs)"
fi
rm -rf "$P2"

# --- MCP surface ----------------------------------------------------------- #
# FastMCP moved out of the `mcp` SDK (2.x) into the standalone `fastmcp` package,
# so planide_mcp accepts either. Capture first: the server exits 1 when neither
# is present (</dev/null so a present one can't hang on stdin), which pipefail
# would otherwise propagate through the grep as a false failure.
MCPMSG=$(python3 mcp/planide_mcp.py </dev/null 2>&1 || true)
echo "$MCPMSG" | grep -qi "fastmcp" \
  && ok "mcp: graceful message when FastMCP is absent" || bad "mcp: graceful message"

# Fake the standalone `fastmcp` package (the newest-first import path), so this
# runs the same on any machine regardless of what is really installed.
FAKE=$(mktemp -d)
printf 'class FastMCP:\n    def __init__(self,n): self.tools=[]\n    def tool(self):\n        def d(f): self.tools.append(f.__name__); return f\n        return d\n    def run(self,**k): pass\n' > "$FAKE/fastmcp.py"
PYTHONPATH="$FAKE" python3 -c "
import importlib.util
s = importlib.util.spec_from_file_location('m','mcp/planide_mcp.py')
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
assert m.FastMCP.__module__ == 'fastmcp', m.FastMCP.__module__
assert m._FASTMCP_KIND == 'standalone', m._FASTMCP_KIND
bad = [t for t in m.mcp.tools if 'verif' in t or 'confirm' in t or 'lock' in t or 'protect' in t]
assert not bad, bad
assert 'get_board' in m.mcp.tools and 'set_item' in m.mcp.tools
" 2>/dev/null \
  && ok "mcp: loads via standalone fastmcp, exposes no confirm/protect tool" \
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
