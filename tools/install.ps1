<#
.SYNOPSIS
  Build, package, sign, install, and launch Clean TV Home on a Samsung Tizen TV on Windows.
.USAGE
  .\tools\install.ps1 -TvIp 192.168.254.113
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$TvIp,
  [string]$CliPath = "",
  [string]$TmdbKeyPath = "$env:USERPROFILE\.config\tv-home\tmdb.key"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppDir = Join-Path $Root "app"
$DistApp = Join-Path $Root "dist\app"
$WgtOut = Join-Path $Root "dist\tv-home.wgt"

if (-not $CliPath) {
  $candidates = @(
    (Join-Path $Root "..\apps2samsung\apps2samsung-cli.exe"),
    "apps2samsung-cli.exe"
  )
  foreach ($c in $candidates) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { $CliPath = $cmd.Source; break }
    if (Test-Path $c) { $CliPath = (Resolve-Path $c).Path; break }
  }
}

if (-not $CliPath -or -not (Test-Path $CliPath)) {
  throw "apps2samsung-cli.exe not found. Pass -CliPath <path-to-apps2samsung-cli.exe>."
}

if (Test-Path $DistApp) { Remove-Item -Recurse -Force $DistApp }
New-Item -ItemType Directory -Force -Path (Split-Path $DistApp) | Out-Null
Copy-Item -Recurse -Force $AppDir $DistApp

if (Test-Path $TmdbKeyPath) {
  $key = (Get-Content -Raw $TmdbKeyPath).Trim()
  if ($key) {
    Set-Content -Path (Join-Path $DistApp "js\key.js") -Value "window.TVHOME_TMDB_KEY = `"$key`";" -Encoding UTF8
    Write-Host "TMDB key: found"
  }
} else {
  Write-Host "TMDB key: none, using keyless TVMaze live show art + Art Institute of Chicago fallback"
}

if (Test-Path $WgtOut) { Remove-Item -Force $WgtOut }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($WgtOut, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Recurse -File $DistApp | Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($DistApp.Length).TrimStart('\', '/').Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}

Write-Host "Built package: $WgtOut"
& $CliPath install $WgtOut --tv $TvIp --yes --plain
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install tv-home.wgt onto $TvIp"
}
& $CliPath launch TvHome0001.Home --tv $TvIp --plain
