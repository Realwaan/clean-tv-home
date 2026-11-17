<#
.SYNOPSIS
  Package and install Clean TV Home (.ipk) onto an LG webOS Smart TV on Windows.
.USAGE
  .\tools\install-lg.ps1
  .\tools\install-lg.ps1 -Device lg
#>
param(
  [string]$Device = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Packager = Join-Path $Root "tools\package-lg.mjs"
$IpkPath = Join-Path $Root "dist\org.cleantv.home_0.2.0_all.ipk"

node $Packager

if (-not (Test-Path $IpkPath)) {
  throw "Failed to build $IpkPath"
}

$aresInstall = Get-Command "ares-install" -ErrorAction SilentlyContinue
$aresLaunch = Get-Command "ares-launch" -ErrorAction SilentlyContinue

if ($Device -and $aresInstall) {
  Write-Host "Installing $IpkPath onto LG device '$Device'..."
  & $aresInstall.Source -d $Device $IpkPath
  if ($aresLaunch) {
    Write-Host "Launching org.cleantv.home..."
    & $aresLaunch.Source -d $Device org.cleantv.home
  }
} else {
  Write-Host ""
  Write-Host "Built LG webOS package: $IpkPath"
  Write-Host ""
  Write-Host "Next steps to install on any LG webOS TV (2014-2025):"
  Write-Host "  1. Enable Developer Mode on your LG TV (LG Content Store -> Developer Mode app -> Dev Mode Status ON)."
  Write-Host "  2. Open webOS Dev Manager on PC (or run: ares-install -d <device> $IpkPath)."
  Write-Host "  3. Drag & drop $IpkPath in Dev Manager -> Install -> Launch Clean TV Home."
}
