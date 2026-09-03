$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $PSScriptRoot '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$setupVersionFile = Join-Path $PSScriptRoot 'setup-version.txt'
$installedVersionFile = Join-Path $venv 'opus-copy-setup-version.txt'
$setupRequired = -not (Test-Path $python)

if (-not $setupRequired) {
  $expectedVersion = if (Test-Path $setupVersionFile) { (Get-Content $setupVersionFile -Raw).Trim() } else { '' }
  $installedVersion = if (Test-Path $installedVersionFile) { (Get-Content $installedVersionFile -Raw).Trim() } else { '' }
  $setupRequired = -not $expectedVersion -or $installedVersion -ne $expectedVersion
}

if ($setupRequired) {
  Write-Host 'Preparando ou atualizando o ambiente Python...' -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot 'setup.ps1')
  if ($LASTEXITCODE -ne 0) {
    throw 'Não foi possível configurar o ambiente Python do OPUS-COPY.'
  }
}

if (-not (Test-Path $python)) {
  throw "O Python do ambiente virtual não foi encontrado após o setup: $python"
}

# Executar python.exe diretamente não ativa a venv. Inclua Scripts no PATH para
# que shutil.which/Get-Command também encontrem yt-dlp.exe e outras ferramentas.
$env:Path = "$(Join-Path $venv 'Scripts');$env:Path"
$env:PYTHONUTF8 = '1'

Set-Location $projectRoot
& $python (Join-Path $PSScriptRoot 'responsive_launcher.py')
exit $LASTEXITCODE
