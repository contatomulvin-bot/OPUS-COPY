param(
  [string]$InstallPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\OPUS-COPY\app'),
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repositoryUrl = 'https://github.com/contatomulvin-bot/OPUS-COPY.git'
$dataRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'OPUS-COPY\data'

function Write-Step([string]$Message) {
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $knownPaths = @(
    (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Microsoft\WinGet\Links'),
    (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Python\Launcher'),
    (Join-Path ${env:ProgramFiles} 'Git\cmd'),
    (Join-Path ${env:ProgramFiles} 'nodejs')
  ) | Where-Object { Test-Path $_ }
  $env:Path = (($knownPaths + @($machinePath, $userPath)) -join ';')
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $previousPreference = $ErrorActionPreference
  $exitCode = -1
  try {
    # Native tools commonly write harmless progress and warnings to stderr.
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    throw "$FailureMessage (código $exitCode)."
  }
}

function Require-Winget {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Windows Package Manager (winget) não encontrado. Atualize o App Installer pela Microsoft Store e tente novamente.'
  }
  return $winget.Source
}

function Install-WingetPackage {
  param(
    [Parameter(Mandatory = $true)][string]$PackageId,
    [Parameter(Mandatory = $true)][string]$DisplayName
  )
  Write-Step "Instalando $DisplayName"
  $winget = Require-Winget
  Invoke-Native -FilePath $winget -Arguments @(
    'install', '--id', $PackageId, '--exact', '--silent',
    '--accept-package-agreements', '--accept-source-agreements'
  ) -FailureMessage "Não foi possível instalar $DisplayName"
  Refresh-ProcessPath
}

function Test-Python311 {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if (-not $launcher) { return $false }
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'SilentlyContinue'
    & $launcher.Source -3.11 -c "import sys; raise SystemExit(0 if sys.maxsize > 2**32 else 1)" *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Test-Node22 {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  try {
    $version = (& $node.Source --version).Trim().TrimStart('v')
    return [int]($version.Split('.')[0]) -ge 22
  } catch {
    return $false
  }
}

function Set-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )
  $safeValue = $Value.Replace('"', '\"')
  $line = "$Name=`"$safeValue`""
  $content = if (Test-Path $Path) { [IO.File]::ReadAllText($Path) } else { '' }
  $pattern = '(?m)^' + [regex]::Escape($Name) + '\s*=.*$'
  if ([regex]::IsMatch($content, $pattern)) {
    $content = [regex]::Replace($content, $pattern, { param($match) $line })
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
    $content += "$line`r`n"
  }
  [IO.File]::WriteAllText($Path, $content, (New-Object Text.UTF8Encoding($false)))
}

function Get-DotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path $Path)) { return '' }
  $match = [regex]::Match([IO.File]::ReadAllText($Path), '(?m)^' + [regex]::Escape($Name) + '\s*=\s*(.*)$')
  if (-not $match.Success) { return '' }
  return $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Read-SecureText([string]$Prompt) {
  $secureValue = Read-Host -Prompt $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function New-AppShortcut([string]$ApplicationRoot) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { return }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $desktop 'OPUS-COPY.lnk'))
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $ApplicationRoot 'desktop\run.ps1')`""
  $shortcut.WorkingDirectory = $ApplicationRoot
  $shortcut.Description = 'Abrir OPUS-COPY'
  $shortcut.Save()
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'O instalador do OPUS-COPY funciona somente no Windows.'
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'O OPUS-COPY exige Windows de 64 bits.'
}

Write-Host 'OPUS-COPY — INSTALADOR AUTOMÁTICO' -ForegroundColor White
Write-Host 'O instalador verificará e baixará os componentes necessários.' -ForegroundColor DarkGray
Refresh-ProcessPath

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Install-WingetPackage -PackageId 'Git.Git' -DisplayName 'Git'
}
if (-not (Test-Python311)) {
  Install-WingetPackage -PackageId 'Python.Python.3.11' -DisplayName 'Python 3.11 (64 bits)'
}
if (-not (Test-Node22)) {
  Install-WingetPackage -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS'
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
  Install-WingetPackage -PackageId 'Gyan.FFmpeg' -DisplayName 'FFmpeg e FFprobe'
}

Refresh-ProcessPath
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git foi instalado, mas ainda não está disponível. Reinicie o Windows e execute o instalador novamente.' }
if (-not (Test-Python311)) { throw 'Python 3.11 foi instalado, mas o launcher py não está disponível. Reinicie o Windows e execute o instalador novamente.' }
if (-not (Test-Node22)) { throw 'Node.js 22 ou superior não ficou disponível. Reinicie o Windows e execute o instalador novamente.' }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) { throw 'FFmpeg foi instalado, mas ainda não está disponível. Reinicie o Windows e execute o instalador novamente.' }

Write-Step 'Baixando o OPUS-COPY'
$installParent = Split-Path -Parent $InstallPath
New-Item -ItemType Directory -Force -Path $installParent | Out-Null
if (Test-Path (Join-Path $InstallPath '.git')) {
  Push-Location $InstallPath
  try {
    Invoke-Native -FilePath 'git' -Arguments @('fetch', 'origin', 'main') -FailureMessage 'Não foi possível verificar atualizações do OPUS-COPY'
    Invoke-Native -FilePath 'git' -Arguments @('pull', '--ff-only', 'origin', 'main') -FailureMessage 'Não foi possível atualizar o OPUS-COPY; existem alterações locais na pasta de instalação'
  } finally {
    Pop-Location
  }
} elseif (Test-Path $InstallPath) {
  $items = @(Get-ChildItem -Force -Path $InstallPath -ErrorAction SilentlyContinue)
  if ($items.Count -gt 0) { throw "A pasta $InstallPath já existe e não pertence ao OPUS-COPY." }
  Invoke-Native -FilePath 'git' -Arguments @('clone', '--depth', '1', $repositoryUrl, $InstallPath) -FailureMessage 'Não foi possível baixar o OPUS-COPY'
} else {
  Invoke-Native -FilePath 'git' -Arguments @('clone', '--depth', '1', $repositoryUrl, $InstallPath) -FailureMessage 'Não foi possível baixar o OPUS-COPY'
}

Write-Step 'Configurando dados e chave do Gemini'
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$envPath = Join-Path $InstallPath '.env'
if (-not (Test-Path $envPath)) {
  Copy-Item -LiteralPath (Join-Path $InstallPath '.env.example') -Destination $envPath
}
Set-DotEnvValue -Path $envPath -Name 'OPUS_COPY_DATA_DIR' -Value $dataRoot.Replace('\', '/')

$geminiKey = Get-DotEnvValue -Path $envPath -Name 'GEMINI_API_KEY'
if ([string]::IsNullOrWhiteSpace($geminiKey) -or $geminiKey -in @('MY_GEMINI_API_KEY', 'SUA_CHAVE')) {
  Write-Host 'Cole sua chave da API Gemini. Ela não aparecerá na tela.' -ForegroundColor Yellow
  Write-Host 'Se ainda não possuir uma chave, pressione Enter e configure o arquivo .env depois.' -ForegroundColor DarkGray
  $geminiKey = Read-SecureText 'GEMINI_API_KEY'
  if (-not [string]::IsNullOrWhiteSpace($geminiKey)) {
    Set-DotEnvValue -Path $envPath -Name 'GEMINI_API_KEY' -Value $geminiKey
  }
}

Write-Step 'Preparando inteligência artificial e processamento de vídeo'
$setupScript = Join-Path $InstallPath 'desktop\setup.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
Invoke-Native -FilePath $powershell -Arguments @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $setupScript
) -FailureMessage 'O setup interno do OPUS-COPY falhou'

New-AppShortcut -ApplicationRoot $InstallPath
Write-Host ''
Write-Host 'INSTALAÇÃO CONCLUÍDA!' -ForegroundColor Green
Write-Host "Aplicativo: $InstallPath" -ForegroundColor Green
Write-Host "Dados e clips: $dataRoot" -ForegroundColor Green
Write-Host 'Um atalho foi criado na Área de Trabalho.' -ForegroundColor Green

if (-not $SkipLaunch) {
  Start-Process -FilePath $powershell -WorkingDirectory $InstallPath -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $InstallPath 'desktop\run.ps1')
  )
}
