$ErrorActionPreference = 'Stop'

$runScript = Join-Path $PSScriptRoot 'desktop\run.ps1'
if (-not (Test-Path $runScript)) {
  throw "Inicializador do desktop não encontrado: $runScript"
}

& $runScript
exit $LASTEXITCODE
