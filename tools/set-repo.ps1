<#
  Quest Weaver: point the module at your repository.

  Fills in the manifest, download, url and bugs fields that Foundry uses to
  install and update the module. Run this once after creating the GitHub repo.

    .\tools\set-repo.ps1 -Owner your-github-username
    .\tools\set-repo.ps1 -Owner your-github-username -Repo quest-weaver
#>
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = "quest-weaver"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $root "quest-weaver\module.json"

$url = "https://github.com/$Owner/$Repo"
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.url      = $url
$manifest.bugs     = "$url/issues"
$manifest.manifest = "$url/releases/latest/download/module.json"
$manifest.download = "$url/releases/download/v$($manifest.version)/quest-weaver.zip"
$manifest | ConvertTo-Json -Depth 20 | Set-Content $manifestPath -Encoding UTF8

# Keep the README's install link in step with the manifest.
$readmePath = Join-Path $root "quest-weaver\README.md"
if (Test-Path $readmePath) {
  (Get-Content $readmePath -Raw -Encoding UTF8) `
    -replace "https://github\.com/[^/\s)]+/quest-weaver", $url |
    Set-Content $readmePath -Encoding UTF8
}

Write-Host "Repository set to $url" -ForegroundColor Green
Write-Host "Manifest URL for testers: $($manifest.manifest)"
