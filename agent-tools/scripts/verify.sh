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

# --- agent-budget.py: Claude Code's agent-description cap ------------------ #
# "Agent descriptions are over the 15.0k-token limit" is stacked copies of the
# roster. The diagnostic has to count the way Claude Code counts, remove only
# generated roster copies, and never an agent someone wrote.
AB="$DIR/scripts/agent-budget.py"
BH="$(mktemp -d)"
mkdir -p "$BH/.claude/agents" "$BH/.codex/agents" "$BH/.gemini/config/agents/pulsar-council"
roster() { printf -- '---\nname: %s\ndescription: %s\n---\n\nPersona.\n\n## Activation signal\n' "$1" "$2"; }
roster pulse-council  "$(printf 'c%.0s' $(seq 1 390))" > "$BH/.claude/agents/pulse-council.md"
roster pulsar-council "$(printf 'c%.0s' $(seq 1 390))" > "$BH/.claude/agents/pulsar-council.md"
roster thepunisher-council "x" > "$BH/.claude/agents/thepunisher-council.md"
roster pulsar-council "x" > "$BH/.gemini/config/agents/pulsar-council/agent.md"
printf 'name = "pulsar-council"\ndeveloper_instructions = %s\n## Activation signal\n%s\n' "'''" "'''" > "$BH/.codex/agents/pulsar-council.toml"
printf -- '---\nname: pulse-mine\ndescription: my own helper\n---\nhi\n' > "$BH/.claude/agents/pulse-mine.md"
printf -- '---\nname: reviewer\ndescription: >\n  reviews\n  my PRs\n---\nhi\n' > "$BH/.claude/agents/reviewer.md"

python3 -m py_compile "$AB" 2>/dev/null && ok "agent-budget: compiles" || bad "agent-budget: compiles"
# pulse-council: "pulse-council: " + 390 = 405 -> 101; pulsar-council 406 -> 102 (round half to even);
# thepunisher-council: 22 -> 6; pulse-mine: 24 -> 6; reviewer (folded "reviews my PRs"): 24 -> 6.
python3 "$AB" --home "$BH" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
sys.exit(0 if r['total'] == 101 + 102 + 6 + 6 + 6 and r['over'] is False and len(r['stale']) == 4 else 1)" \
  && ok "agent-budget: counts like Claude Code and finds the stale copies in every root" \
  || bad "agent-budget: count or stale detection"
python3 "$AB" --home "$BH" --prune --dry-run >/dev/null 2>&1
[ -f "$BH/.claude/agents/pulsar-council.md" ] \
  && ok "agent-budget: --dry-run removes nothing" || bad "agent-budget: --dry-run removed files"
python3 "$AB" --home "$BH" --prune >/dev/null 2>&1
{ [ ! -e "$BH/.claude/agents/pulsar-council.md" ] && [ ! -e "$BH/.claude/agents/thepunisher-council.md" ] \
  && [ ! -e "$BH/.codex/agents/pulsar-council.toml" ] && [ ! -e "$BH/.gemini/config/agents/pulsar-council" ]; } \
  && ok "agent-budget: --prune removes old-prefix copies (no marker: pulse-* is current)" \
  || bad "agent-budget: --prune left a stale copy"
{ [ -f "$BH/.claude/agents/pulse-council.md" ] && [ -f "$BH/.claude/agents/pulse-mine.md" ] \
  && [ -f "$BH/.claude/agents/reviewer.md" ]; } \
  && ok "agent-budget: the current roster and hand-written agents survive" \
  || bad "agent-budget: removed something that was not a stale copy"
for i in $(seq 1 160); do
  printf -- '---\nname: role-%s\ndescription: %s\n---\n' "$i" "$(printf 'r%.0s' $(seq 1 400))" > "$BH/.claude/agents/role-$i.md"
done
python3 "$AB" --home "$BH" >/dev/null 2>&1; rc=$?
[ "$rc" = 1 ] && [ "$(ls "$BH/.claude/agents" | grep -c '^role-')" = 160 ] \
  && ok "agent-budget: over the cap exits 1 and deletes none of the user's agents" \
  || bad "agent-budget: over-cap exit ($rc) or user agents touched"
python3 "$AB" --home "$BH/nope" >/dev/null 2>&1; [ $? = 2 ] \
  && ok "agent-budget: a missing home is an error (exit 2)" || bad "agent-budget: missing home exit code"
rm -rf "$BH"

rm -rf "$TESTCFG" "$PROJ"
echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] && { echo "ALL GREEN"; exit 0; } || { echo "SELF-TEST FAILED"; exit 1; }
