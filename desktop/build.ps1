$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host '== OPUS-COPY / Windows EXE build ==' -ForegroundColor Cyan

$venvPython = Join-Path (Get-Location) 'desktop\.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  throw 'Ambiente Python não encontrado. Execute .\desktop\setup.ps1 primeiro.'
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install pyinstaller pillow
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar ferramentas de build.' }

$runtimeDir = Join-Path (Get-Location) 'desktop\runtime'
$distDir = Join-Path (Get-Location) 'desktop\dist\OPUS-COPY'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

# Make a Windows ICO from the existing SVG using Qt + Pillow, if possible.
$icoPath = Join-Path (Get-Location) 'desktop\assets\opus-copy-logo.ico'
$makeIcon = @'
from pathlib import Path
import sys
try:
    from PySide6.QtCore import QByteArray, QBuffer, QIODevice
    from PySide6.QtGui import QImage, QPainter
    from PySide6.QtSvg import QSvgRenderer
    from PIL import Image
except Exception as exc:
    print(f"ICON_SKIP: {exc}")
    raise SystemExit(0)

root = Path(sys.argv[1])
svg = root / "desktop" / "assets" / "opus-copy-logo.svg"
ico = root / "desktop" / "assets" / "opus-copy-logo.ico"
renderer = QSvgRenderer(str(svg))
if not renderer.isValid():
    print("ICON_SKIP: SVG inválido")
    raise SystemExit(0)
images = []
for size in (16, 24, 32, 48, 64, 128, 256):
    image = QImage(size, size, QImage.Format.Format_ARGB32)
    image.fill(0)
    painter = QPainter(image)
    renderer.render(painter)
    painter.end()
    images.append(image)

# Convert through PNG bytes so Pillow can write a proper multi-size ICO.
pil_images = []
for image in images:
    buffer = QBuffer()
    buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    image.save(buffer, "PNG")
    pil_images.append(Image.open(QByteArray(bytes(buffer.data())) if False else __import__('io').BytesIO(bytes(buffer.data()))).convert("RGBA"))

pil_images[0].save(ico, format="ICO", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)], append_images=pil_images[1:])
print(f"ICON_OK: {ico}")
'@
& $venvPython -c $makeIcon (Get-Location)

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

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue 'desktop\build'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue 'desktop\dist'

& $venvPython -m PyInstaller --noconfirm --clean desktop\opus_copy.spec
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
