# Install Adnan's BB customization layer on Windows.
# Run from a clone of the bb-setup repo (PowerShell).
#
# Plugins install straight from this clone's git origin (subdirectory install)
# — BB installs their npm dependencies itself, so Node.js is NOT required.
# Re-running skips already-installed plugins.
$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$BbDir = Join-Path $env:USERPROFILE '.bb'

$Origin = (git -C $Repo remote get-url origin 2>$null)
if (-not $Origin) { throw "No git origin in $Repo — run this from a clone of the bb-setup repo." }

Write-Host '== Theme: cyber-punk'
$ThemeDir = Join-Path $BbDir 'theme\cyber-punk'
New-Item -ItemType Directory -Force $ThemeDir | Out-Null
Copy-Item (Join-Path $Repo 'theme\cyber-punk\theme.css') (Join-Path $ThemeDir 'theme.css') -Force
bb theme set cyber-punk

$Installed = (bb plugin list --json | ConvertFrom-Json).plugins.id
foreach ($Sub in 'plugins/adnan-mission-control', 'plugins/cyberpunk-terminal') {
  $Id = Split-Path -Leaf $Sub
  if ($Installed -contains $Id) {
    Write-Host "== Plugin: $Id already installed (refresh with: bb plugin update $Id)"
  } else {
    Write-Host "== Plugin: $Id"
    bb plugin install "git:$Origin" --subdirectory $Sub
  }
}

Write-Host '== Done. Verify with: bb plugin list'
