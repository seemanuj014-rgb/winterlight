# Winterlight gate release: merge dev into main (production), tag, push. Run at gates G0-G3 only.
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1 -Version 0.2.0
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path .git)) { throw 'Run this from the repo root (the folder with .git).' }
$pkg = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($pkg -ne $Version) { throw "package.json says $pkg, expected $Version. Extract the changed-files zip first." }
git checkout main
git merge dev --no-edit
git push origin main
git tag "v$Version"
git push origin "v$Version"
git checkout dev
Write-Host "Released v$Version. Vercel is updating production. Check the Deployments tab."
