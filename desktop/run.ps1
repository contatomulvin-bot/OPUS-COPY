$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$python = Join-Path (Get-Location) 'desktop\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
  throw 'Ambiente desktop não configurado. Execute .\desktop\setup.ps1 primeiro.'
}
& $python desktop\main.py
