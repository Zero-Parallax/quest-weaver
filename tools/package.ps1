<#
  Quest Weaver: build a release.

  Produces dist\quest-weaver.zip (what Foundry downloads) and dist\module.json
  (what Foundry reads to decide whether an update exists). Both are what you
  attach to a GitHub release.

  The manifest inside the zip points at the *specific* version, while the one
  published alongside it points at "latest". That is what makes Foundry's
  update check work. Getting these two the wrong way round is the usual reason
  a module installs but never updates.

    .\tools\package.ps1                 # version comes from module.json
    .\tools\package.ps1 -Version 0.2.0  # also stamps the new version into module.json
#>
param(
  [string]$Version,
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$module = Join-Path $root "quest-weaver"
$dist = Join-Path $root "dist"
$manifestPath = Join-Path $module "module.json"

if (-not $SkipChecks) {
  Write-Host "Running static checks..." -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "check.ps1") | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Static checks failed - fix them before releasing." }
}

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($Version) {
  $manifest.version = $Version
} else {
  $Version = $manifest.version
}

if ($manifest.url -match "YOUR-GITHUB-USERNAME") {
  Write-Warning "module.json still has the placeholder repository URL."
  Write-Warning "Run tools\set-repo.ps1 -Owner <you> first, or the manifest and download links will not work."
}

# The copy inside the zip is pinned to this exact version.
$manifest.manifest = "$($manifest.url)/releases/download/v$Version/module.json"
$manifest.download = "$($manifest.url)/releases/download/v$Version/quest-weaver.zip"
$manifest | ConvertTo-Json -Depth 20 | Set-Content $manifestPath -Encoding UTF8

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

$zipPath = Join-Path $dist "quest-weaver.zip"
Write-Host "Packing $Version..." -ForegroundColor Cyan

# Entries are written by hand rather than with Compress-Archive.
#
# Two reasons. Foundry expects module.json at the archive *root*, not inside a
# nested folder; and Windows PowerShell's Compress-Archive writes backslash path
# separators, which the ZIP format does not allow. Foundry's extractor treats
# "scripts\main.js" as one long filename, so the module installs as a flat heap
# of oddly-named files and fails to load.
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
  $sep = [System.IO.Path]::DirectorySeparatorChar
  $prefix = (Resolve-Path $module).Path.TrimEnd($sep) + $sep
  foreach ($file in Get-ChildItem $module -Recurse -File) {
    $entryName = $file.FullName.Substring($prefix.Length).Replace($sep, '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $file.FullName, $entryName) | Out-Null
  }
} finally {
  $archive.Dispose()
}

# The published manifest tracks "latest" so Foundry can see new versions.
$published = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$published.manifest = "$($published.url)/releases/latest/download/module.json"
$published.download = "$($published.url)/releases/download/v$Version/quest-weaver.zip"
$published | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $dist "module.json") -Encoding UTF8

$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host ""
Write-Host "Built quest-weaver $Version" -ForegroundColor Green
Write-Host "  dist\quest-weaver.zip   ($size KB)  <- attach to the release"
Write-Host "  dist\module.json                    <- attach to the release"
Write-Host ""
Write-Host "Install URL for testers once the release is published:" -ForegroundColor Cyan
Write-Host "  $($published.manifest)"
