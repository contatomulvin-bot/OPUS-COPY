$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host '== OPUS-COPY / WhisperX setup ==' -ForegroundColor Cyan

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  throw 'Python não encontrado. Instale Python 3.11 x64 e marque Add Python to PATH durante a instalação.'
}

$version = & python --version
Write-Host "Python: $version"

if (-not (Test-Path '.venv-whisperx\Scripts\python.exe')) {
  & python -m venv .venv-whisperx
}

$venvPython = Join-Path (Get-Location) '.venv-whisperx\Scripts\python.exe'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements-whisperx.txt

Write-Host ''
Write-Host 'WhisperX instalado no ambiente .venv-whisperx.' -ForegroundColor Green
Write-Host 'Teste:' -ForegroundColor Yellow
& $venvPython -c "import whisperx; print('WhisperX OK')"
