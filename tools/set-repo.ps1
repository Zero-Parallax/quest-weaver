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

# Windows PowerShell's `Set-Content -Encoding UTF8` writes a byte order mark.
# Foundry parses module.json with JSON.parse, which rejects a leading BOM with
# "Unexpected token", so every write here goes through this instead.
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}


$url = "https://github.com/$Owner/$Repo"
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.url       = $url
$manifest.bugs      = "$url/issues"
$manifest.readme    = "$url#readme"
$manifest.changelog = "$url/blob/main/CHANGELOG.md"
$manifest.manifest  = "$url/releases/latest/download/module.json"
$manifest.download  = "$url/releases/download/v$($manifest.version)/quest-weaver.zip"
Write-Utf8NoBom $manifestPath ($manifest | ConvertTo-Json -Depth 20)

# Keep the README's install link in step with the manifest.
$readmePath = Join-Path $root "README.md"
if (Test-Path $readmePath) {
  $readme = (Get-Content $readmePath -Raw -Encoding UTF8) `
    -replace "https://github\.com/[^/\s)]+/quest-weaver", $url
  Write-Utf8NoBom $readmePath $readme
}

Write-Host "Repository set to $url" -ForegroundColor Green
Write-Host "Manifest URL for testers: $($manifest.manifest)"
