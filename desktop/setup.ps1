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

& $venvPython -c "import PySide6, yt_dlp, whisperx; import bgutil_ytdlp_pot_provider; print('Desktop dependencies OK')"
if ($LASTEXITCODE -ne 0) { throw 'A validação das dependências falhou.' }

# YouTube PO Token provider. yt-dlp's current YouTube guidance recommends
# using a provider plugin, and bgutil can run its provider script through Node.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Node.js não encontrado e o winget também não está disponível. Instale Node.js LTS (20+) e execute este setup novamente.'
  }
  Write-Host 'Node.js não encontrado. Instalando Node.js LTS...' -ForegroundColor Yellow
  & winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    $nodePath = Join-Path ${env:ProgramFiles} 'nodejs\node.exe'
    if (Test-Path $nodePath) {
      $env:Path = "$(Split-Path $nodePath);$env:Path"
      $node = Get-Command node -ErrorAction SilentlyContinue
    }
  }
}
if (-not $node) { throw 'Node.js LTS não pôde ser encontrado após a instalação.' }

$potRoot = Join-Path $env:USERPROFILE 'bgutil-ytdlp-pot-provider'
if (-not (Test-Path (Join-Path $potRoot '.git'))) {
  Write-Host 'Baixando bgutil-ytdlp-pot-provider 1.3.1...' -ForegroundColor Yellow
  & git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git $potRoot
} else {
  Write-Host 'Atualizando bgutil-ytdlp-pot-provider...' -ForegroundColor Yellow
  Push-Location $potRoot
  & git fetch --depth 1 origin tag 1.3.1
  & git checkout --force 1.3.1
  Pop-Location
}

$potServer = Join-Path $potRoot 'server'
if (-not (Test-Path (Join-Path $potServer 'package.json'))) {
  throw "Provider não encontrado em $potServer"
}

Push-Location $potServer
& npm ci
& npx tsc
Pop-Location
if ($LASTEXITCODE -ne 0) { throw 'A compilação do PO Token Provider falhou.' }

# The provider plugin discovers this default location automatically.
$env:BGUTIL_YTDLP_PROVIDER_HOME = $potRoot

Write-Host 'Validando PO Token Provider...' -ForegroundColor Yellow
$probe = & $venvPython -m yt_dlp --version
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível executar o yt-dlp do ambiente desktop.' }
Write-Host "yt-dlp: $probe"

Write-Host 'Setup concluído com suporte a PO Token.' -ForegroundColor Green
Write-Host 'Para iniciar:' -ForegroundColor Green
Write-Host '.\desktop\run.ps1'
