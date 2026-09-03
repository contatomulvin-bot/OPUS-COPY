$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host '== OPUS-COPY / Windows EXE build ==' -ForegroundColor Cyan

$venvPython = Join-Path (Get-Location) 'desktop\.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  throw 'Ambiente Python não encontrado. Execute .\desktop\setup.ps1 primeiro.'
}
$env:Path = "$(Split-Path $venvPython);$env:Path"

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install pyinstaller pillow
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar ferramentas de build.' }

$runtimeDir = Join-Path (Get-Location) 'desktop\runtime'
$buildDir = Join-Path (Get-Location) 'desktop\build'
$distRoot = Join-Path (Get-Location) 'desktop\dist'
$distDir = Join-Path (Get-Location) 'desktop\dist\OPUS-COPY'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

# Make a proper multi-resolution Windows ICO from the existing SVG.
$icoPath = Join-Path (Get-Location) 'desktop\assets\opus-copy-logo.ico'
& $venvPython desktop\create_icon.py
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $icoPath)) {
  throw 'Falha ao criar o ícone do Windows a partir da logo.'
}

# Copy external command-line tools into the build output when available.
foreach ($name in @('yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe')) {
  $command = Get-Command ($name -replace '\.exe$','') -ErrorAction SilentlyContinue
  if ($command) {
    Copy-Item $command.Source (Join-Path $runtimeDir $name) -Force
    Write-Host "Runtime incluído: $name" -ForegroundColor Green
  } else {
    Write-Warning "$name não encontrado no PATH; o EXE continuará esperando o programa no PATH."
  }
}

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $buildDir
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $distRoot

& $venvPython -m PyInstaller --noconfirm --clean --workpath $buildDir --distpath $distRoot desktop\opus_copy.spec
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller falhou ao montar o OPUS-COPY.exe.' }

if (-not (Test-Path $distDir)) { throw "Pasta de saída não encontrada: $distDir" }
New-Item -ItemType Directory -Force -Path (Join-Path $distDir 'runtime') | Out-Null
if (Test-Path $runtimeDir) {
  Copy-Item (Join-Path $runtimeDir '*') (Join-Path $distDir 'runtime') -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'BUILD CONCLUÍDO.' -ForegroundColor Green
Write-Host "Executável: $distDir\OPUS-COPY.exe" -ForegroundColor Green
Write-Host 'Observação: o PO Token Provider continua sendo usado da pasta do usuário (%USERPROFILE%\bgutil-ytdlp-pot-provider) e o Node.js continua sendo uma dependência externa.' -ForegroundColor Yellow
