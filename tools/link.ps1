<#
  Quest Weaver: dev link.

  Creates a directory junction from the Foundry modules folder to this repo so
  edits are live. Junctions do not need elevation. Foundry only discovers new
  module folders at server start, so restart Foundry once after the first run.
#>
param(
  [string]$DataPath = "$env:LOCALAPPDATA\FoundryVTT\Data",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$source = Join-Path (Split-Path $PSScriptRoot -Parent) "quest-weaver"
$target = Join-Path $DataPath "modules\quest-weaver"

if (-not (Test-Path $source)) { throw "Module source not found at $source" }
if (-not (Test-Path (Join-Path $DataPath "modules"))) { throw "No modules folder at $DataPath" }

if ($Remove) {
  if (Test-Path $target) {
    $item = Get-Item $target -Force
    if ($item.LinkType -eq "Junction") { $item.Delete(); "Removed junction $target" }
    else { throw "$target is a real folder, not a junction - refusing to delete it" }
  } else { "Nothing to remove." }
  return
}

if (Test-Path $target) {
  $item = Get-Item $target -Force
  if ($item.LinkType -eq "Junction") { "Junction already exists: $target -> $($item.Target)"; return }
  throw "$target already exists as a real folder. Move it aside first."
}

New-Item -ItemType Junction -Path $target -Value $source | Out-Null
"Linked $target -> $source"
"Restart the Foundry server once so it discovers the new module."
