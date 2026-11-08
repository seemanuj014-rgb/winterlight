# Winterlight phase push. Run from the repo root in the VS Code terminal AFTER extracting the changed-files zip over the repo folder.
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\push_phase.ps1 -Message "Phase 5: reference intake"
param([Parameter(Mandatory = $true)][string]$Message)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path .git)) { throw 'Run this from the repo root (the folder with .git).' }
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'dev') { git checkout dev }
git add .
git commit -m $Message
git push origin dev
Write-Host "Pushed to dev. Vercel is building a preview: open vercel.com, Deployments, newest one, then open it on your phone."
