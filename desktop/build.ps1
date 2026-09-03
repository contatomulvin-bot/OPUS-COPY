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

# The pip-generated yt-dlp.exe launcher points back to this virtual
# environment and is not portable.  Ship yt-dlp's official standalone Windows
# executable so the packaged application also works on a clean computer.
$ytDlpPath = Join-Path $runtimeDir 'yt-dlp.exe'
$ytDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
Write-Host 'Baixando o executável independente oficial do yt-dlp...' -ForegroundColor Yellow
Invoke-WebRequest -Uri $ytDlpUrl -OutFile $ytDlpPath -UseBasicParsing
if (-not (Test-Path $ytDlpPath)) {
  throw 'Não foi possível incluir o yt-dlp independente no build.'
}
& $ytDlpPath --version
if ($LASTEXITCODE -ne 0) { throw 'O yt-dlp independente incluído no build não executou corretamente.' }
Write-Host 'Runtime incluído: yt-dlp.exe' -ForegroundColor Green

# FFmpeg and FFprobe are native standalone binaries on Windows.  Use the
# installed copies when possible; otherwise download the release essentials
# build linked by the official FFmpeg download page.
$missingFfmpegTools = @()
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
  $command = Get-Command ($name -replace '\.exe$','') -ErrorAction SilentlyContinue
  if ($command) {
    Copy-Item $command.Source (Join-Path $runtimeDir $name) -Force
    Write-Host "Runtime incluído: $name" -ForegroundColor Green
  } else {
    $missingFfmpegTools += $name
  }
}

if ($missingFfmpegTools.Count -gt 0) {
  $ffmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  $ffmpegTemp = Join-Path ([System.IO.Path]::GetTempPath()) ("opus-copy-ffmpeg-" + [guid]::NewGuid().ToString('N'))
  $ffmpegZip = Join-Path $ffmpegTemp 'ffmpeg.zip'
  $ffmpegExtract = Join-Path $ffmpegTemp 'extracted'
  try {
    New-Item -ItemType Directory -Force -Path $ffmpegExtract | Out-Null
    Write-Host 'Baixando FFmpeg/FFprobe para o pacote Windows...' -ForegroundColor Yellow
    Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
    Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force
    foreach ($name in $missingFfmpegTools) {
      $candidate = Get-ChildItem -Path $ffmpegExtract -Filter $name -Recurse -File | Select-Object -First 1
      if (-not $candidate) { throw "O arquivo $name não foi encontrado no pacote baixado do FFmpeg." }
      Copy-Item $candidate.FullName (Join-Path $runtimeDir $name) -Force
      Write-Host "Runtime incluído: $name" -ForegroundColor Green
    }
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ffmpegTemp
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

foreach ($name in @('yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe')) {
  $packagedTool = Join-Path (Join-Path $distDir 'runtime') $name
  if (-not (Test-Path $packagedTool)) {
    throw "Ferramenta obrigatória ausente do pacote: $name"
  }
}

Write-Host ''
Write-Host 'BUILD CONCLUÍDO.' -ForegroundColor Green
Write-Host "Executável: $distDir\OPUS-COPY.exe" -ForegroundColor Green
Write-Host 'Observação: o Node.js continua sendo uma dependência externa para os desafios JavaScript do YouTube.' -ForegroundColor Yellow
