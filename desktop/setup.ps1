$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Update-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machinePath, $userPath) -join ';'
}

function Get-Python311Command {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) {
    & $launcher.Source -3.11 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" *> $null
    if ($LASTEXITCODE -eq 0) {
      return [PSCustomObject]@{ File = $launcher.Source; Args = @('-3.11') }
    }
  }

  foreach ($name in @('python3.11', 'python')) {
    $candidate = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $candidate) { continue }
    & $candidate.Source -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" *> $null
    if ($LASTEXITCODE -eq 0) {
      return [PSCustomObject]@{ File = $candidate.Source; Args = @() }
    }
  }
  return $null
}

function Install-WithWinget([string]$Id, [string]$DisplayName) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "$DisplayName não foi encontrado e o winget não está disponível. Instale $DisplayName e execute novamente."
  }
  Write-Host "Instalando/atualizando $DisplayName..." -ForegroundColor Yellow
  & $winget.Source install --id $Id --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "O winget não conseguiu instalar $DisplayName (pacote $Id)."
  }
  Update-ProcessPath
}

function Restore-CpuCTranslate2([string]$Python) {
  Write-Warning 'A aceleração ROCm não ficou disponível. Restaurando CTranslate2 para CPU; o aplicativo continuará funcionando.'
  & $Python -m pip install --no-cache-dir --force-reinstall 'ctranslate2>=4.4,<5'
  if ($LASTEXITCODE -ne 0) {
    throw 'Também não foi possível restaurar o CTranslate2 para CPU.'
  }
}

Write-Host '== OPUS-COPY Desktop / configuração automática ==' -ForegroundColor Cyan

$pythonCommand = Get-Python311Command
if (-not $pythonCommand) {
  Install-WithWinget 'Python.Python.3.11' 'Python 3.11 x64'
  $pythonCommand = Get-Python311Command
}
if (-not $pythonCommand) {
  throw 'Python 3.11 x64 não foi encontrado após a instalação. Feche e abra o PowerShell e tente novamente.'
}

$pythonArgs = @($pythonCommand.Args)
$pythonFile = $pythonCommand.File
$pythonVersion = (& $pythonFile @pythonArgs -c "import platform; print(platform.python_version())").Trim()
Write-Host "Python $pythonVersion encontrado." -ForegroundColor Green

$venv = Join-Path $PSScriptRoot '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
if (Test-Path $venvPython) {
  & $venvPython -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)" *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'O ambiente virtual existente usa outra versão do Python. Recriando...' -ForegroundColor Yellow
    Remove-Item -Recurse -Force $venv
  }
}
if (-not (Test-Path $venvPython)) {
  & $pythonFile @pythonArgs -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ambiente virtual Python.' }
}

$env:Path = "$(Join-Path $venv 'Scripts');$env:Path"
$env:PYTHONUTF8 = '1'

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'A atualização do pip falhou.' }
& $venvPython -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'A instalação das dependências Python falhou.' }

# Older releases installed bgutil globally in this venv.  Its script provider
# may select Deno behind the application's back and abort valid downloads.
& $venvPython -m pip uninstall --yes bgutil-ytdlp-pot-provider *> $null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível remover o provider antigo do yt-dlp.' }

& $venvPython -c "import PySide6, dotenv, google.genai, yt_dlp, yt_dlp_ejs, faster_whisper, cv2; print('Dependências Python OK')"
if ($LASTEXITCODE -ne 0) { throw 'A validação das dependências Python falhou.' }

# A falha na tentativa de aceleração AMD nunca deve impedir o app de abrir:
# CPU/int8 continua sendo um fallback compatível.
$gpuNames = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
$amdGpu = ($gpuNames -join ' ') -match 'AMD|Radeon'
if ($amdGpu) {
  Write-Host "AMD Radeon detectada: $($gpuNames -join ', ')" -ForegroundColor Yellow
  Write-Host 'Tentando configurar faster-whisper + ROCm para GPU...' -ForegroundColor Yellow

  & $venvPython -m pip install --no-cache-dir `
    'https://repo.radeon.com/rocm/windows/rocm-rel-7.2/rocm_sdk_core-7.2.0.dev0-py3-none-win_amd64.whl' `
    'https://repo.radeon.com/rocm/windows/rocm-rel-7.2/rocm_sdk_libraries_custom-7.2.0.dev0-py3-none-win_amd64.whl' `
    'https://repo.radeon.com/rocm/windows/rocm-rel-7.2/rocm-7.2.0.dev0.tar.gz'
  $rocmRuntimeReady = $LASTEXITCODE -eq 0

  if ($rocmRuntimeReady) {
    $rocmCt2 = 'https://github.com/PinW/ctranslate2-rocm-wheels/releases/download/v4.7.1-rocm72/ctranslate2-4.7.1-cp311-cp311-win_amd64.whl'
    & $venvPython -m pip install --no-cache-dir $rocmCt2 --force-reinstall --no-deps
    $rocmRuntimeReady = $LASTEXITCODE -eq 0
  }

  if ($rocmRuntimeReady) {
    & $venvPython -c "import ctranslate2; count=ctranslate2.get_cuda_device_count(); print('CTranslate2', ctranslate2.__version__, '| GPU devices:', count); raise SystemExit(0 if count > 0 else 1)"
    $rocmRuntimeReady = $LASTEXITCODE -eq 0
  }

  if (-not $rocmRuntimeReady) {
    Restore-CpuCTranslate2 $venvPython
  } else {
    Write-Host 'Aceleração AMD/ROCm validada.' -ForegroundColor Green
  }
} else {
  Write-Host 'GPU AMD não detectada. faster-whisper usará CPU/int8 quando CUDA não estiver disponível.' -ForegroundColor DarkYellow
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffmpeg -or -not $ffprobe) {
  Install-WithWinget 'Gyan.FFmpeg' 'FFmpeg/FFprobe'
  $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
  $ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
}
if (-not $ffmpeg -or -not $ffprobe) {
  throw 'FFmpeg ou FFprobe não foi encontrado após a instalação. Feche e abra o PowerShell e execute .\iniciar.ps1 novamente.'
}
Write-Host 'FFmpeg e FFprobe encontrados.' -ForegroundColor Green

# yt-dlp EJS uses Node 22+ for YouTube JavaScript challenges.
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeMajor = 0
if ($node) {
  $nodeVersion = (& $node.Source --version).Trim()
  try { $nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0]) } catch { $nodeMajor = 0 }
}
if ($nodeMajor -lt 22) {
  Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js 22+ LTS'
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $nodeVersion = (& $node.Source --version).Trim()
    try { $nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0]) } catch { $nodeMajor = 0 }
  }
}
if (-not $node -or $nodeMajor -lt 22) {
  throw 'Node.js 22+ não foi encontrado após a instalação. Feche e abra o PowerShell e tente novamente.'
}
Write-Host "Node.js $nodeVersion OK." -ForegroundColor Green

& $venvPython -m yt_dlp --ignore-config --version
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível executar o yt-dlp do ambiente desktop.' }

& $venvPython (Join-Path $PSScriptRoot 'create_icon.py')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ícone do OPUS-COPY.' }

$setupVersionFile = Join-Path $PSScriptRoot 'setup-version.txt'
$installedVersionFile = Join-Path $venv 'opus-copy-setup-version.txt'
if (Test-Path $setupVersionFile) {
  Copy-Item $setupVersionFile $installedVersionFile -Force
}

Write-Host ''
Write-Host 'Configuração concluída.' -ForegroundColor Green
Write-Host 'Nas próximas vezes, inicie somente com:' -ForegroundColor Green
Write-Host '.\iniciar.ps1' -ForegroundColor White
