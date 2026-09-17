# Install Adnan's BB customization layer on Windows.
# Idempotent: re-running re-copies the theme and re-points the plugins.
$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$BbDir = Join-Path $env:USERPROFILE '.bb'

Write-Host '== Theme: cyber-punk'
$ThemeDir = Join-Path $BbDir 'theme\cyber-punk'
New-Item -ItemType Directory -Force $ThemeDir | Out-Null
Copy-Item (Join-Path $Repo 'theme\cyber-punk\theme.css') (Join-Path $ThemeDir 'theme.css') -Force
bb theme set cyber-punk

Write-Host '== Plugin: adnan-mission-control'
bb plugin install "path:$(Join-Path $Repo 'plugins\adnan-mission-control')"

Write-Host '== Plugin: cyberpunk-terminal'
bb plugin install "path:$(Join-Path $Repo 'plugins\cyberpunk-terminal')"

Write-Host '== Done. Verify with: bb plugin list'
