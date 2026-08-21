<#
.SYNOPSIS
    Install Ghidra headless (Windows) -- Team 5 Reverse Engineering Command.

.DESCRIPTION
    Downloads the latest official Ghidra release from NationalSecurityAgency/ghidra
    (Apache-2.0, NSA open-source), verifies its published SHA-256 digest, extracts it, and sets
    GHIDRA_HOME as a persistent User environment variable (survives reboots, no admin needed) so
    analyzeHeadless.bat is usable with zero manual setup in any new PowerShell/cmd session.
    Fully headless: this script never opens a GUI, and neither does analyzeHeadless itself.

    Requires a JDK 21 (64-bit) on PATH or JAVA_HOME -- verified against Ghidra's own
    GhidraDocs/GettingStarted.md. This script checks for one and tells you where to get a free
    one (Adoptium Temurin / Amazon Corretto) if it's missing; it does not install a JDK for you.

.PARAMETER InstallDir
    Target directory. Default: %LOCALAPPDATA%\ThePunisher\ghidra

.PARAMETER Verify
    Do not download; only verify an existing install.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-ghidra.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-ghidra.ps1 -Verify
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'ThePunisher\ghidra'),
    [switch]$Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'NationalSecurityAgency/ghidra'

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  OK $msg"  -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  !! $msg"  -ForegroundColor Yellow }

function Test-Java21 {
    $javaCmd = Get-Command java -ErrorAction SilentlyContinue
    if (-not $javaCmd) {
        Write-Warn2 "no 'java' on PATH -- Ghidra needs a JDK 21 (64-bit) runtime+dev kit."
        Write-Warn2 "Free LTS builds: https://adoptium.net (Temurin) or https://aws.amazon.com/corretto"
        return $false
    }
    $out = & java -version 2>&1 | Out-String
    # Same real-world gotcha as the bash installer: don't assume the version line
    # is first -- some setups print diagnostics before it. Search the whole output.
    if ($out -match '"(\d+)') {
        $ver = [int]$Matches[1]
        if ($ver -lt 21) {
            Write-Warn2 "java on PATH reports version $ver; Ghidra requires JDK 21+."
            Write-Warn2 "Get one: https://adoptium.net or https://aws.amazon.com/corretto"
            return $false
        }
        Write-Ok "java $ver found on PATH"
        return $true
    }
    Write-Warn2 "could not parse a java version from 'java -version' output"
    return $false
}

function Get-LatestReleaseAsset {
    param([Parameter(Mandatory)][string]$RepoSlug, [string]$MatchPattern = '\.zip$')
    $api = "https://api.github.com/repos/$RepoSlug/releases/latest"
    $headers = @{ 'User-Agent' = 'ThePunisher-RE-Installer' }
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
    $rel = Invoke-RestMethod -Uri $api -Headers $headers
    $asset = $rel.assets | Where-Object { $_.name -match $MatchPattern } | Select-Object -First 1
    if (-not $asset) { throw "No asset matching '$MatchPattern' in latest release of $RepoSlug" }
    [pscustomobject]@{ Url = $asset.browser_download_url; Name = $asset.name; Tag = $rel.tag_name; Digest = $asset.digest }
}

function Find-GhidraHome {
    Get-ChildItem -Path $InstallDir -Directory -Filter 'ghidra_*_PUBLIC' -ErrorAction SilentlyContinue |
        Sort-Object Name | Select-Object -Last 1 -ExpandProperty FullName
}

# --------------------------------------------------------------------------- Verify-only mode
if ($Verify) {
    Write-Step "Verifying install at $InstallDir"
    $home = Find-GhidraHome
    $headless = if ($home) { Join-Path $home 'support\analyzeHeadless.bat' } else { $null }
    if (-not $home -or -not (Test-Path $headless)) {
        Write-Warn2 "no working Ghidra install found under $InstallDir"
        exit 1
    }
    Write-Ok "Ghidra verified: $home"
    Test-Java21 | Out-Null
    exit 0
}

# --------------------------------------------------------------------------- Install
Write-Step "Installing Ghidra headless -> $InstallDir"
if (-not (Test-Java21)) {
    Write-Warn2 "continuing anyway -- analyzeHeadless will just fail until a JDK 21 is on PATH"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("punisher-ghidra-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    Write-Step "Resolving latest release from $Repo..."
    $g = Get-LatestReleaseAsset -RepoSlug $Repo -MatchPattern '\.zip$'
    Write-Ok "Latest: $($g.Tag) ($($g.Name))"

    $zip = Join-Path $tmp $g.Name
    Write-Step 'Downloading...'
    Invoke-WebRequest -Uri $g.Url -OutFile $zip -Headers @{ 'User-Agent' = 'ThePunisher-RE-Installer' }

    if ($g.Digest -and $g.Digest -match '^([a-zA-Z0-9]+):([0-9a-fA-F]+)$') {
        $algo = $Matches[1].ToUpper() -replace '-', ''
        $want = $Matches[2]
        Write-Step "Verifying published digest ($algo)..."
        $got = (Get-FileHash -Algorithm $algo -Path $zip).Hash
        if ($got -ne $want.ToUpper()) {
            throw "digest mismatch! got $got, expected $($want.ToUpper()) -- download corrupted or tampered, aborting"
        }
        Write-Ok "digest verified ($algo)"
    } else {
        Write-Warn2 "release did not publish a digest for this asset -- skipping verification"
    }

    Write-Step "Extracting..."
    Expand-Archive -Path $zip -DestinationPath $InstallDir -Force

    $ghidraHome = Find-GhidraHome
    if (-not $ghidraHome) { throw "extracted, but couldn't find ghidra_*_PUBLIC under $InstallDir" }

    [Environment]::SetEnvironmentVariable('GHIDRA_HOME', $ghidraHome, 'User')
    $env:GHIDRA_HOME = $ghidraHome  # this session too, not just future ones
    Write-Ok "GHIDRA_HOME set (User, persistent) -> $ghidraHome"

    Write-Step "Verifying analyzeHeadless responds..."
    $headlessBat = Join-Path $ghidraHome 'support\analyzeHeadless.bat'
    $verifyOut = & cmd /c "`"$headlessBat`"" 2>&1 | Out-String
    if ($verifyOut -notmatch 'analyzeHeadless') {
        throw "installed but analyzeHeadless.bat didn't respond as expected"
    }

    Write-Ok "Ghidra $($g.Tag) installed headless -> $ghidraHome"
    Write-Host ''
    Write-Host 'Open a new terminal so GHIDRA_HOME loads, then:' -ForegroundColor Cyan
    Write-Host '  & "$env:GHIDRA_HOME\support\analyzeHeadless.bat" ...   # no GUI, no manual setup'
} finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
