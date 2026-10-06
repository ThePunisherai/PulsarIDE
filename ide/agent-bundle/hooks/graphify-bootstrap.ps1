# Pulse Agent :: graphify SessionStart bootstrap hook (Claude Code, Windows).
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

# Never a "hook error": whatever happens below, the session starts. A failure
# is written to hook-errors.log beside this script -- the same log every other
# PulsarIDE hook uses -- instead of being shown to the user with no cause.
#
# Fast by design. This hook used to run the whole Council memory sync itself,
# Graphify extraction included, inside Claude Code's 30 s budget; on a project
# whose graph took longer Claude Code stopped it and reported "SessionStart hook
# error" at every session start. council-memory.py's `hook` command now answers
# from the last sync at once and starts the refresh in the background.
$log = Join-Path $PSScriptRoot 'hook-errors.log'
try {
    $ErrorActionPreference = 'Stop'

    # Read the payload before anything can return: an agent writing to a pipe
    # nobody reads sees a broken pipe.
    $stdinText = [Console]::In.ReadToEnd()
    $cwd = $null
    try {
        $payload = $stdinText | ConvertFrom-Json
        if ($payload.cwd) { $cwd = [string]$payload.cwd }
    } catch {}
    if (-not $cwd) { $cwd = (Get-Location).Path }
    if (-not (Test-Path -LiteralPath $cwd -PathType Container)) { exit 0 }
    Set-Location -LiteralPath $cwd

    $ctx = ''
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
    $memoryScript = Join-Path $PSScriptRoot 'council-memory.py'
    if ($python -and (Test-Path -LiteralPath $memoryScript)) {
        # A native command's non-zero exit can turn into a terminating
        # NativeCommandError under 'Stop' even with 2>$null (Install.ps1's
        # Known footgun #12): caught here, so it only costs the memory line.
        # council-memory.py writes its own errors to hook-errors.log.
        try {
            $output = @(& $python.Source $memoryScript 'hook' '--project' $cwd '--team' 'The Council' '--event' 'session-start' 2>$null)
        } catch {
            $output = @()
            $global:LASTEXITCODE = 1
        }
        if ($LASTEXITCODE -eq 0 -and $output.Count -gt 0) {
            try {
                $receipt = [string]$output[-1] | ConvertFrom-Json
                $later = if ($receipt.refreshing) { ', refreshing in the background' } else { '' }
                if ($receipt.never_synced) {
                    $ctx = 'Council memory for ' + [string]$receipt.project_name + ' is being built in the background (Graphify + Obsidian).'
                } else {
                    $ctx = 'Council memory for ' + [string]$receipt.project_name + ' v' + [string]$receipt.version +
                        ' (Graphify: ' + [string]$receipt.graphify.status + '; Obsidian: ' + [string]$receipt.obsidian.status + $later + ').'
                }
            } catch {
                $ctx = ''
            }
        }
    }

    # If PulsarIDE already tracks this project, tell the session to use the board.
    # Same guard agent-events.ts uses -- the state file must already exist, so an
    # untracked repo is never nudged and never littered with tracker files.
    $statePath = Join-Path (Join-Path $cwd '.planide') 'state.json'
    if (Test-Path -LiteralPath $statePath) {
        $note = 'This project is tracked by PulsarIDE''s board (.planide/state.json, the IDE Tracker tab). Keep it current without being asked, as your PulsarIDE instructions say: get_board or next_task first (finish wip, then todo, then open fixes), add_item/set_item as the work moves, add_fix for a bug you hit, and update the board before you say done. Pass project="' + $cwd + '" (CLI fallback: plan board "' + $cwd + '").'
        if ($ctx) { $ctx = $ctx + ' ' + $note } else { $ctx = $note }
    }

    if ($ctx) {
        $result = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $ctx } }
        ($result | ConvertTo-Json -Depth 5 -Compress)
    }
} catch {
    try {
        Add-Content -LiteralPath $log -Value ('[graphify-bootstrap] ' + (Get-Date -Format o) + ' ' + $_.ToString())
    } catch {}
}
exit 0
