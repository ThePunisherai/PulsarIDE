# ThePunisher :: graphify SessionStart bootstrap hook (Claude Code, Windows).
#
# PowerShell twin of scripts/graphify-bootstrap.sh -- see that file's header comment for
# the full rationale (converts the "personas should auto-run graphify" instruction from
# prompt-level into something Claude Code's own SessionStart hook enforces). Deployed to
# a stable global location by Deploy-GraphifyHook in Install.ps1 and wired with
# "shell": "powershell" so Claude Code invokes it via powershell.exe even without
# Git Bash/WSL on PATH.
#
# Reads the hook's JSON payload from stdin (SessionStart's payload carries
# {"cwd": ..., "source": ..., ...} per code.claude.com/docs/en/hooks.md) to find the real
# project directory -- not $PWD, since a hook's own working directory is not guaranteed
# to match the session's.

$ErrorActionPreference = 'Stop'

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) { exit 0 }

$stdinText = [Console]::In.ReadToEnd()
$cwd = $null
try {
    $payload = $stdinText | ConvertFrom-Json
    if ($payload.cwd) { $cwd = [string]$payload.cwd }
} catch {}
if (-not $cwd) { $cwd = (Get-Location).Path }
if (-not (Test-Path $cwd)) { exit 0 }
Set-Location $cwd

$memoryScript = Join-Path $PSScriptRoot 'council-memory.py'
if (-not (Test-Path $memoryScript)) { exit 0 }

# council-memory.py owns the bounded Graphify calls and also writes the durable Data
# receipts plus the managed Obsidian project note. Capture only its final JSON line so
# Claude receives concise additional context instead of command output. Wrapped in
# try/catch: a real user's Windows install hit the identical "native command's non-zero
# exit promoted to a terminating NativeCommandError despite 2>$null" bug elsewhere in this
# repo (see Install.ps1's Known footgun #12) -- this hook runs on EVERY Claude Code
# SessionStart, so an uncaught crash here has a much bigger blast radius than a one-time
# install failure and must degrade to "no additional context" silently, never crash.
try {
    $output = @(& $python.Source $memoryScript '--project' $cwd '--team' 'The Council' '--event' 'session-start' 2>$null)
} catch {
    $output = @()
    $global:LASTEXITCODE = 1
}
$ctx = ''
if ($LASTEXITCODE -eq 0 -and $output.Count -gt 0) {
    try {
        $receipt = [string]$output[-1] | ConvertFrom-Json
        $ctx = 'Council memory synced for ' + [string]$receipt.project_name + ' v' +
            [string]$receipt.version + ' (Graphify: ' + [string]$receipt.graphify.status +
            '; Obsidian: ' + [string]$receipt.obsidian.status + ').'
    } catch {
        $ctx = 'Council memory sync completed.'
    }
}

# If PulsarIDE already tracks this project, tell the session to use the board.
# Same guard agent-events.ts uses -- the state file must already exist, so an
# untracked repo is never nudged and never littered with tracker files.
$statePath = Join-Path (Join-Path $cwd '.planide') 'state.json'
if (Test-Path $statePath) {
    $note = 'This project is tracked by PulsarIDE''s built-in board (.planide/state.json), shown live in the IDE Tracker tab. Keep it in sync with this chat automatically, without being asked: read it first with the planide MCP tool get_board (or: plan board "' + $cwd + '"); when the user asks for something or you plan a step, add_item status=todo first; when you start it set_item status=wip; when you get something working set_item status=works; when you find or hit a bug add_fix or set_item status=broken; when the user says something is solved mark_fixed it and set the item to works; and BEFORE you say "done" or "please test" update the board so it matches what you claim. Use the planide MCP tools (add_item, set_item [todo|wip|works|broken|blocked], add_fix, mark_fixed, add_version) or the plan CLI, passing project="' + $cwd + '". Report only what is real -- mark works only when it works; the verified/locked flags stay the user''s.'
    if ($ctx) { $ctx = $ctx + ' ' + $note } else { $ctx = $note }
}

if ($ctx) {
    $result = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $ctx } }
    ($result | ConvertTo-Json -Depth 5 -Compress)
}
exit 0
