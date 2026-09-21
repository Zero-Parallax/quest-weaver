<#
  Quest Weaver: static checks.

  Catches the bug classes that otherwise only surface as a silent broken sheet
  in Foundry: invalid JSON, a data-action with no handler, a missing i18n key,
  a template path that does not exist.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$mod  = Join-Path $root "quest-weaver"
$fail = 0
function Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red; $script:fail++ }
function Pass($msg) { Write-Host "  ok    $msg" -ForegroundColor DarkGreen }

Write-Host "`n[1] JSON validity" -ForegroundColor Cyan
$jsonFiles = @(Get-ChildItem $mod -Filter *.json -Recurse -File)
$jsonFiles += @(Get-ChildItem (Join-Path $root "examples") -Filter *.json -File -ErrorAction SilentlyContinue)
foreach ($f in $jsonFiles) {
  try { Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null; Pass $f.Name }
  catch { Fail "$($f.Name): $($_.Exception.Message)" }
}

$js  = @(Get-ChildItem (Join-Path $mod "scripts") -Filter *.js -Recurse -File)
$hbs = @(Get-ChildItem (Join-Path $mod "templates") -Filter *.hbs -Recurse -File -ErrorAction SilentlyContinue)
$jsText  = ($js  | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
$hbsText = ($hbs | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"

Write-Host "`n[2] data-action handlers" -ForegroundColor Cyan
# Actions ApplicationV2 handles itself, which no module needs to implement.
$builtIn = @("tab", "close", "toggleControls", "copyUuid", "minimize", "maximize")
$actions = [regex]::Matches($hbsText, 'data-action="([^"{}]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
if (-not $actions) { Pass "no data-action attributes yet" }
foreach ($a in $actions) {
  if ($builtIn -contains $a) { Pass "action '$a' (core built-in)"; continue }
  if ($jsText -match "(?m)^\s*$([regex]::Escape($a))\s*[:(]") { Pass "action '$a'" }
  else { Fail "action '$a' has no handler in scripts/" }
}

Write-Host "`n[3] i18n keys" -ForegroundColor Cyan
$lang = Get-Content (Join-Path $mod "lang\en.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$known = @{}
foreach ($p in $lang.PSObject.Properties) { $known[$p.Name] = $true }
$keys = [regex]::Matches("$jsText`n$hbsText", '"(QW\.[A-Za-z0-9_.]+)"') |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$missing = @()
foreach ($k in $keys) {
  # Keys ending in "." are dynamic prefixes built with (concat ...) at runtime.
  if ($k.EndsWith(".")) { continue }
  if ($known.ContainsKey($k)) { continue }
  # A bare namespace is a LOCALIZATION_PREFIXES value, satisfied by any key under it.
  if (($known.Keys | Where-Object { $_.StartsWith("$k.") }).Count -gt 0) { continue }
  $missing += $k
}
if ($missing.Count -eq 0) { Pass "$($keys.Count) key(s) all present" }
else { foreach ($m in $missing) { Fail "missing i18n key $m" } }

# Foundry expands flat dotted keys into a tree. A key that is a strict prefix of
# another ("QW.IO.Action" beside "QW.IO.Action.create") makes the expansion walk
# into a string, which silently drops the module's entire translation namespace.
$collisions = @()
$allKeys = @($known.Keys)
foreach ($k in $allKeys) {
  if ($allKeys | Where-Object { $_.StartsWith("$k.") } | Select-Object -First 1) { $collisions += $k }
}
if ($collisions.Count -eq 0) { Pass "no key/namespace collisions" }
else { foreach ($c in $collisions) { Fail "i18n key '$c' is also a namespace - this breaks ALL module translations" } }

# Dynamic prefixes such as "QW.Status." must have at least one concrete member.
$prefixes = [regex]::Matches($hbsText, 'concat "(QW\.[A-Za-z0-9_.]+\.)"') |
            ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
foreach ($p in $prefixes) {
  $n = ($known.Keys | Where-Object { $_.StartsWith($p) }).Count
  if ($n -gt 0) { Pass "prefix $p ($n entries)" } else { Fail "prefix $p has no entries" }
}

Write-Host "`n[4] template paths" -ForegroundColor Cyan
$paths = [regex]::Matches($jsText, 'modules/\$\{MODULE_ID\}/(templates/[^`"'']+)') |
         ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
if (-not $paths) { Pass "no module template references found" }
foreach ($p in $paths) {
  $full = Join-Path $mod ($p -replace '/', '\')
  if (Test-Path $full) { Pass $p } else { Fail "template not found: $p" }
}

Write-Host "`n[5] manifest sanity" -ForegroundColor Cyan
$m = Get-Content (Join-Path $mod "module.json") -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($rel in $m.esmodules) {
  if (Test-Path (Join-Path $mod ($rel -replace '/', '\'))) { Pass "esmodule $rel" } else { Fail "esmodule missing: $rel" }
}
foreach ($rel in $m.styles) {
  if (Test-Path (Join-Path $mod ($rel -replace '/', '\'))) { Pass "style $rel" } else { Fail "style missing: $rel" }
}
foreach ($l in $m.languages) {
  if (Test-Path (Join-Path $mod ($l.path -replace '/', '\'))) { Pass "lang $($l.path)" } else { Fail "lang missing: $($l.path)" }
}
foreach ($t in $m.documentTypes.JournalEntryPage.PSObject.Properties.Name) {
  if ($jsText -match "$([regex]::Escape($t))\s*:\s*``\`$\{MODULE_ID\}\.$([regex]::Escape($t))``") { Pass "subtype '$t' declared in config.js" }
  elseif ($jsText -match "\`$\{MODULE_ID\}\.$([regex]::Escape($t))") { Pass "subtype '$t' referenced in scripts" }
  else { Fail "subtype '$t' declared in module.json but never referenced in scripts/" }
}

Write-Host ""
if ($fail -eq 0) { Write-Host "All checks passed." -ForegroundColor Green; exit 0 }
Write-Host "$fail check(s) failed." -ForegroundColor Red; exit 1
