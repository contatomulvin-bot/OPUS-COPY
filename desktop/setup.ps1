$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host '== OPUS-COPY Desktop / Python setup ==' -ForegroundColor Cyan

$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python Launcher (py) não encontrado. Instale Python 3.11 x64.' }

$venv = Join-Path (Get-Location) 'desktop\.venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
  & py -3.11 -m venv $venv
}

$venvPython = Join-Path (Get-Location) 'desktop\.venv\Scripts\python.exe'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r desktop\requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'A instalação das dependências Python falhou.' }

& $venvPython -c "import PySide6, yt_dlp, yt_dlp_ejs, faster_whisper; print('Desktop dependencies OK')"
if ($LASTEXITCODE -ne 0) { throw 'A validação das dependências falhou.' }

# faster-whisper uses CTranslate2. On AMD RDNA2/RDNA3/RDNA4 under Windows,
# install the ROCm runtime + the matching CTranslate2 ROCm wheel so the
# Whisper engine can run on the Radeon GPU instead of silently falling back to CPU.
$gpuNames = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
$amdGpu = ($gpuNames -join ' ') -match 'AMD|Radeon'

if ($amdGpu) {
  Write-Host 'AMD Radeon detectada. Configurando faster-whisper + ROCm para GPU...' -ForegroundColor Yellow

  & $venvPython -m pip install --no-cache-dir `
    'https://repo.radeon.com/rocm/windows/rocm-rel-7.2/rocm_sdk_core-7.2.0.dev0-py3-none-win_amd64.whl' `
    'https://repo.radeon.com/rocm/windows/rocm-rel-7.2/rocm_sdk_libraries_custom-7.2.0.dev0-py3-none-win_amd64.whl' `
    'https://repo.radeon.com/rocm/windows/rocm-rel-7.2/rocm-7.2.0.dev0.tar.gz'
  if ($LASTEXITCODE -ne 0) {
    throw 'Não foi possível instalar o runtime ROCm 7.2. Verifique o driver AMD Adrenalin 26.1.1+ e execute o setup novamente.'
  }

  # The official ROCm Windows CTranslate2 wheel is shipped inside the release
  # archive. This direct wheel mirror exposes the exact Python 3.11 wheel.
  $rocmCt2 = 'https://github.com/PinW/ctranslate2-rocm-wheels/releases/download/v4.7.1-rocm72/ctranslate2-4.7.1-cp311-cp311-win_amd64.whl'
  & $venvPython -m pip install --no-cache-dir $rocmCt2 --force-reinstall --no-deps
  if ($LASTEXITCODE -ne 0) {
    throw 'Não foi possível instalar o CTranslate2 ROCm para faster-whisper.'
  }

  & $venvPython -c "import ctranslate2; print('CTranslate2', ctranslate2.__version__); print('GPU devices:', ctranslate2.get_cuda_device_count())"
  if ($LASTEXITCODE -ne 0) {
    throw 'CTranslate2 ROCm foi instalado, mas a GPU não pôde ser detectada. Verifique o driver AMD/ROCm.'
  }
} else {
  Write-Host 'GPU AMD não detectada. Mantendo faster-whisper em CPU/int8.' -ForegroundColor DarkYellow
}

# YouTube PO Token provider + supported JS runtime.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Node.js não encontrado e o winget também não está disponível. Instale Node.js 22+ LTS e execute este setup novamente.'
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

$nodeVersion = (& node --version).Trim()
$nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 22) {
  throw "Node.js $nodeVersion encontrado. O yt-dlp-ejs atual exige Node.js 22+. Atualize o Node.js e execute este setup novamente."
}
Write-Host "Node.js $nodeVersion OK (>= 22)" -ForegroundColor Green

$potRoot = Join-Path $env:USERPROFILE 'bgutil-ytdlp-pot-provider'
if (-not (Test-Path (Join-Path $potRoot '.git'))) {
  Write-Host 'Baixando bgutil-ytdlp-pot-provider 1.3.2...' -ForegroundColor Yellow
  & git clone --depth 1 --branch 1.3.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git $potRoot
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar o PO Token Provider.' }
} else {
  Write-Host 'Atualizando bgutil-ytdlp-pot-provider...' -ForegroundColor Yellow
  Push-Location $potRoot
  & git fetch --depth 1 origin tag 1.3.2
  & git checkout --force 1.3.2
  $checkoutCode = $LASTEXITCODE
  Pop-Location
  if ($checkoutCode -ne 0) { throw 'Não foi possível atualizar o PO Token Provider.' }
}

$potServer = Join-Path $potRoot 'server'
if (-not (Test-Path (Join-Path $potServer 'package.json'))) {
  throw "Provider não encontrado em $potServer"
}

Push-Location $potServer
& npm ci
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'A instalação do Node.js do PO Token Provider falhou.' }
& npx tsc
$compileCode = $LASTEXITCODE
Pop-Location
if ($compileCode -ne 0) { throw 'A compilação do PO Token Provider falhou.' }

Write-Host 'Validando instalação do PO Token Provider e EJS...' -ForegroundColor Yellow
& $venvPython -m yt_dlp -v --ignore-config --version 2>&1 | Select-String -Pattern 'yt-dlp|yt_dlp_ejs|bgutil|JS runtimes' | Select-Object -First 20
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível executar o yt-dlp do ambiente desktop.' }

Write-Host 'Setup concluído com faster-whisper + ROCm (AMD, quando disponível), EJS e suporte a PO Token.' -ForegroundColor Green
Write-Host 'Para iniciar:' -ForegroundColor Green
Write-Host '.\desktop\run.ps1'
