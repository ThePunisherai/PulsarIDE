<#
.SYNOPSIS
    Install the Binary Ninja headless MCP bridge (Windows) -- Team 5 Reverse Engineering Command.

.DESCRIPTION
    Installs mrphrazer/binary-ninja-headless-mcp (GPL-2.0, verified live: 213 stars at last
    check) from a pinned commit -- not on PyPI, so this is a `pip install git+...@<sha>` rather
    than a package-name install, chosen for reproducibility over installing whatever is on
    `main` that day.

    IMPORTANT: this script installs the *bridge* only. Binary Ninja itself is COMMERCIAL
    software (a paid, per-seat license, with a headless-capable tier required for real
    analysis) -- this repo cannot install or provide that license for you. Without it, the
    bridge still installs and runs in `--fake-backend` mode (upstream's own CI/dev mode) but
    cannot analyze real binaries. Ghidra (free, NSA open-source; see install-ghidra.ps1) is
    ThePunisher's default disassembler for exactly this reason.

.PARAMETER Verify
    Do not install; only verify an existing install.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-binja-mcp.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-binja-mcp.ps1 -Verify
#>
[CmdletBinding()]
param(
    [switch]$Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'mrphrazer/binary-ninja-headless-mcp'
# Pinned to a known-good commit (verified live against the real repo) for reproducible
# installs. Override with $env:BINJA_MCP_REF if you want a different ref.
$Pin = if ($env:BINJA_MCP_REF) { $env:BINJA_MCP_REF } else { '49c39c2d4427b586ce1ec3499baa86c38f980ece' }

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  OK $msg"  -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  !! $msg"  -ForegroundColor Yellow }

function Find-ConsoleScript {
    foreach ($name in @('binary_ninja_headless_mcp', 'binary-ninja-headless-mcp')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

function Test-BinaryNinjaModule {
    # Wrapped in try/catch: this probe is EXPECTED to fail with a non-zero exit for most
    # users (no licensed Binary Ninja install), and on real Windows that non-zero exit can
    # get promoted to a terminating NativeCommandError despite the stream redirect -- see
    # Install.ps1's Known footgun #12 for the full story (found via a real user's crash).
    try {
        $out = & python -c "import binaryninja" 2>&1
    } catch {
        $out = $null
        $global:LASTEXITCODE = 1
    }
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "binaryninja Python module importable -- a real, licensed Binary Ninja install was found"
        return $true
    }
    Write-Warn2 "binaryninja Python module not importable -- no real Binary Ninja install detected"
    Write-Warn2 "the bridge will still install and run, but only in --fake-backend mode until you"
    Write-Warn2 "install Binary Ninja yourself (commercial license required, this repo can't provide it)"
    return $false
}

if ($Verify) {
    Write-Step "Verifying binary-ninja-headless-mcp bridge install"
    $script = Find-ConsoleScript
    if (-not $script) { Write-Warn2 "bridge not installed (run without -Verify)"; exit 1 }
    Write-Ok "bridge installed: $script"
    & $script --help *> $null
    if ($LASTEXITCODE -ne 0) { Write-Warn2 "bridge installed but --help failed to run"; exit 1 }
    Write-Ok "bridge responds to --help"
    Test-BinaryNinjaModule | Out-Null
    exit 0
}

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw "python (3.11+) is required and must be on PATH" }
$verOut = & python -c "import sys; print(sys.version_info[0]*100+sys.version_info[1])"
if ([int]$verOut -lt 311) { throw "python 3.11+ required (found $(& python --version 2>&1)) -- upstream's own minimum" }

Write-Step "Installing binary-ninja-headless-mcp bridge (pinned to $Pin)..."
& python -m pip install --user "git+https://github.com/$Repo.git@$Pin"
if ($LASTEXITCODE -ne 0) { throw "pip install failed -- check network access and that git is on PATH" }

$script = Find-ConsoleScript
if (-not $script) { throw "installed, but no binary_ninja_headless_mcp console script found on PATH (check your pip --user Scripts dir is on PATH)" }
Write-Ok "bridge installed -> $script"

Write-Step "Verifying it responds..."
& $script --help *> $null
if ($LASTEXITCODE -ne 0) { throw "installed but --help failed to run" }
Write-Ok "bridge responds to --help"

Test-BinaryNinjaModule | Out-Null

Write-Host ''
Write-Host 'MCP client config (see ..\mcp\mcp-re-tools.json for the full entry):' -ForegroundColor Cyan
Write-Host "  command: $script"
Write-Host '  args:    []                    # stdio transport (default)'
Write-Host '  args:    ["--fake-backend"]     # no real Binary Ninja install? test with this'
Write-Host ''
Write-Host 'Merge it in: ..\Install.ps1 -WithReMcp   (or copy the "binary-ninja" block from'
Write-Host 'mcp-re-tools.json into your mcp.json by hand)'
