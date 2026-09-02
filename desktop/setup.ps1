$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host '== OPUS-COPY Desktop / Python setup ==' -ForegroundColor Cyan

$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python Launcher (py) não encontrado. Instale Python 3.11 x64.' }

$venv = Join-Path (Get-Location) 'desktop\.venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
  & py -3.11 -m venv $venv
}

$venvPython = Join-Path $venv 'Scripts\python.exe'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r desktop\requirements.txt

& $venvPython -c "import PySide6, yt_dlp, whisperx; print('Desktop dependencies OK')"
if ($LASTEXITCODE -ne 0) { throw 'A validação das dependências falhou.' }

Write-Host 'Setup concluído. Para iniciar:' -ForegroundColor Green
Write-Host '.\desktop\run.ps1'
