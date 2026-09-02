$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host '== OPUS-COPY / WhisperX setup ==' -ForegroundColor Cyan

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python não encontrado. Instale Python 3.11 x64 e marque Add Python to PATH durante a instalação.' }

$version = & python --version
Write-Host "Python: $version"

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { throw 'FFmpeg não encontrado e winget não está disponível. Instale FFmpeg e coloque-o no PATH.' }
  Write-Host 'FFmpeg não encontrado. Instalando Gyan.FFmpeg...' -ForegroundColor Yellow
  & winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if (-not $ffmpeg) { throw 'FFmpeg foi instalado, mas ainda não está no PATH desta sessão. Feche e abra o PowerShell e execute o script novamente.' }
}
Write-Host "FFmpeg: $(& ffmpeg -version | Select-Object -First 1)"

if (-not (Test-Path '.venv-whisperx\Scripts\python.exe')) { & python -m venv .venv-whisperx }
$venvPython = Join-Path (Get-Location) '.venv-whisperx\Scripts\python.exe'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements-whisperx.txt

Write-Host ''
Write-Host 'WhisperX instalado no ambiente .venv-whisperx.' -ForegroundColor Green
Write-Host 'Teste de importação:' -ForegroundColor Yellow
& $venvPython -c "import whisperx; print('WhisperX OK')"
Write-Host 'Teste do FFmpeg:' -ForegroundColor Yellow
& ffmpeg -version | Select-Object -First 1
