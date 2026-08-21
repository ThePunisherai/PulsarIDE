<#
.SYNOPSIS
    Install x64dbg + Scylla/ScyllaHide + the ThePunisher RE plugin suite (headless-capable).

.DESCRIPTION
    Downloads the latest x64dbg release snapshot and the standard reverse-engineering plugin
    set, copies each plugin's .dp32/.dp64 into the correct x64dbg plugin directories, writes a
    version+hash manifest, installs the ScyllaHide "ThePunisher" anti-anti-debug profile, and
    verifies the result.

    Windows only (x64dbg is a native Windows app). Run from an elevated PowerShell if you want
    it on PATH machine-wide; user-scope install needs no elevation.

.PARAMETER InstallDir
    Target directory. Default: %LOCALAPPDATA%\ThePunisher\x64dbg

.PARAMETER SkipPlugins
    Install x64dbg only (Scylla is bundled with x64dbg regardless).

.PARAMETER Verify
    Do not download; only verify an existing install against the manifest.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-x64dbg.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-x64dbg.ps1 -Verify
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'ThePunisher\x64dbg'),
    [switch]$SkipPlugins,
    [switch]$Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # much faster Invoke-WebRequest downloads
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Plugins we provision. Scylla itself is bundled inside x64dbg; these are the extras.
# The set is data-driven: plugins.json (next to this script) is the source of truth so you
# can add plugins without editing PowerShell. Each entry needs a GitHub repo that publishes
# .dp32/.dp64 release assets. If a repo/asset is missing the installer WARNS and continues
# (it never invents a plugin). Only ScyllaHide is hardcoded as the always-safe built-in.
$PluginManifest = Join-Path $PSScriptRoot 'plugins.json'
if (Test-Path $PluginManifest) {
    try {
        $Plugins = @(Get-Content $PluginManifest -Raw -Encoding UTF8 | ConvertFrom-Json |
                     Where-Object { $_.enabled -ne $false } |
                     ForEach-Object { @{ Name = $_.name; Repo = $_.repo } })
        Write-Host "  plugin manifest: $($Plugins.Count) enabled entr(ies) from plugins.json"
    } catch {
        Write-Warning "plugins.json unreadable ($($_.Exception.Message)); using built-in default"
        $Plugins = @( @{ Name = 'ScyllaHide'; Repo = 'x64dbg/ScyllaHide' } )
    }
} else {
    $Plugins = @( @{ Name = 'ScyllaHide'; Repo = 'x64dbg/ScyllaHide' } )
}

$ReleaseDir = Join-Path $InstallDir 'release'
$Plug64     = Join-Path $ReleaseDir 'x64\plugins'
$Plug32     = Join-Path $ReleaseDir 'x32\plugins'
$ManifestPath = Join-Path $ReleaseDir 'plugins-manifest.json'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK $msg"  -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "  !! $msg"  -ForegroundColor Yellow }

function Get-LatestReleaseAsset {
    param([Parameter(Mandatory)][string]$Repo, [string]$MatchPattern = '\.zip$')
    $api = "https://api.github.com/repos/$Repo/releases/latest"
    $headers = @{ 'User-Agent' = 'ThePunisher-RE-Installer' }
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
    $rel = Invoke-RestMethod -Uri $api -Headers $headers
    $asset = $rel.assets | Where-Object { $_.name -match $MatchPattern } | Select-Object -First 1
    if (-not $asset) { throw "No asset matching '$MatchPattern' in latest release of $Repo" }
    [pscustomobject]@{ Url = $asset.browser_download_url; Name = $asset.name; Tag = $rel.tag_name }
}

function Save-Download {
    param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$OutFile)
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers @{ 'User-Agent' = 'ThePunisher-RE-Installer' }
    return (Get-FileHash -Algorithm SHA256 -Path $OutFile).Hash
}

# --------------------------------------------------------------------------- Verify-only mode
if ($Verify) {
    Write-Step "Verifying install at $InstallDir"
    $expected = @('x64\x64dbg.exe', 'x32\x32dbg.exe')
    $missing = @()
    foreach ($rel in $expected) {
        if (-not (Test-Path (Join-Path $ReleaseDir $rel))) { $missing += $rel }
    }
    if (Test-Path $ManifestPath) {
        $manifest = Get-Content $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($f in $manifest.files) {
            if (-not (Test-Path $f.path)) { $missing += $f.path }
        }
        Write-Ok "manifest: $($manifest.files.Count) plugin file(s), x64dbg $($manifest.x64dbg_tag)"
    } else {
        Write-Warn2 "no plugins-manifest.json -- plugins may not be installed"
    }
    if ($missing.Count -gt 0) {
        Write-Warn2 "MISSING:"; $missing | ForEach-Object { Write-Host "     - $_" }
        exit 1
    }
    Write-Ok "verification passed"
    exit 0
}

# --------------------------------------------------------------------------- Install
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("punisher-x64dbg-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    # 1) x64dbg snapshot
    Write-Step 'Fetching latest x64dbg snapshot'
    $x = Get-LatestReleaseAsset -Repo 'x64dbg/x64dbg' -MatchPattern 'snapshot_.*\.zip$'
    $zip = Join-Path $tmp $x.Name
    $x64Hash = Save-Download -Url $x.Url -OutFile $zip
    Write-Ok "downloaded $($x.Name) ($($x.Tag))"

    Write-Step "Extracting x64dbg to $InstallDir"
    Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
    if (-not (Test-Path (Join-Path $ReleaseDir 'x64\x64dbg.exe'))) {
        throw "x64dbg.exe not found after extraction -- unexpected archive layout"
    }
    Write-Ok 'x64dbg extracted (Scylla plugin is bundled)'

    New-Item -ItemType Directory -Force -Path $Plug64, $Plug32 | Out-Null

    # 2) Plugins
    $manifestFiles = New-Object System.Collections.Generic.List[object]
    if (-not $SkipPlugins) {
        foreach ($p in $Plugins) {
            Write-Step "Installing plugin: $($p.Name)"
            try {
                $a = Get-LatestReleaseAsset -Repo $p.Repo -MatchPattern '\.zip$'
                $pzip = Join-Path $tmp $a.Name
                Save-Download -Url $a.Url -OutFile $pzip | Out-Null
                $pdir = Join-Path $tmp ($p.Name + '_x')
                Expand-Archive -Path $pzip -DestinationPath $pdir -Force

                $copied = 0
                foreach ($ext in '*.dp64','*.dp32') {
                    $dest = if ($ext -eq '*.dp64') { $Plug64 } else { $Plug32 }
                    Get-ChildItem -Path $pdir -Recurse -Filter $ext -ErrorAction SilentlyContinue | ForEach-Object {
                        $target = Join-Path $dest $_.Name
                        Copy-Item $_.FullName $target -Force
                        $manifestFiles.Add([pscustomobject]@{
                            plugin = $p.Name; tag = $a.Tag; path = $target
                            sha256 = (Get-FileHash -Algorithm SHA256 $target).Hash
                        })
                        $copied++
                    }
                }
                # Ship any auxiliary config (e.g. scylla_hide.ini, .json, .dll deps) alongside plugins
                Get-ChildItem -Path $pdir -Recurse -Include '*.ini','*.json' -ErrorAction SilentlyContinue | ForEach-Object {
                    Copy-Item $_.FullName (Join-Path $Plug64 $_.Name) -Force -ErrorAction SilentlyContinue
                    Copy-Item $_.FullName (Join-Path $Plug32 $_.Name) -Force -ErrorAction SilentlyContinue
                }
                if ($copied -eq 0) { Write-Warn2 "no .dp32/.dp64 found for $($p.Name) -- check archive layout" }
                else { Write-Ok "$($p.Name) ($($a.Tag)): $copied plugin binary(ies)" }
            } catch {
                Write-Warn2 "skipped $($p.Name): $($_.Exception.Message)"
            }
        }
    }

    # 3) ScyllaHide anti-anti-debug profile
    $iniBody = @'
[SETTINGS]
Profile=ThePunisher

[ThePunisher]
PEB_BeingDebugged=1
PEB_HeapFlags=1
PEB_NtGlobalFlag=1
NtQueryInformationProcess_ProcessDebugFlags=1
NtQueryInformationProcess_ProcessDebugObjectHandle=1
NtQueryInformationProcess_ProcessDebugPort=1
NtSetInformationThread_ThreadHideFromDebugger=1
NtQueryObject_ObjectTypeInformation=1
NtQueryObject_ObjectAllTypesInformation=1
OutputDebugStringA=1
BlockInput=1
GetTickCount=1
GetTickCount64=1
NtQueryPerformanceCounter=1
NtQuerySystemTime=1
'@
    foreach ($d in $Plug64, $Plug32) {
        Set-Content -Path (Join-Path $d 'scylla_hide.ini') -Value $iniBody -Encoding ASCII
    }
    Write-Ok 'ScyllaHide "ThePunisher" profile written'

    # 4) Manifest
    $manifest = [pscustomobject]@{
        installed_at = (Get-Date).ToString('o')
        install_dir  = $InstallDir
        x64dbg_tag   = $x.Tag
        x64dbg_sha256 = $x64Hash
        files        = $manifestFiles
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $ManifestPath -Encoding UTF8
    Write-Ok "manifest written: $ManifestPath"

    Write-Host ''
    Write-Host 'ThePunisher x64dbg RE suite installed.' -ForegroundColor Green
    Write-Host ("  x64dbg : {0}" -f (Join-Path $ReleaseDir 'x64\x64dbg.exe'))
    Write-Host ("  plugins: {0}" -f $Plug64)
    Write-Host '  Verify : powershell -ExecutionPolicy Bypass -File .\install-x64dbg.ps1 -Verify'
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
