# Entry point del refresh programado del catálogo (lo llama el Task Scheduler).
# Corre el orquestador Node y guarda toda la salida en un log con timestamp.
# Instalar la tarea: scripts\install-refresh-task.ps1

$ErrorActionPreference = "Continue"

# Raíz del proyecto = carpeta padre de este script.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Carpeta de logs.
$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $logDir "refresh-$stamp.log"

# node tiene que estar en el PATH del usuario que corre la tarea.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  "[$(Get-Date -Format s)] ✗ No se encontró 'node' en el PATH. Instalá Node o ajustá el PATH de la tarea." |
    Out-File -FilePath $log -Encoding utf8
  exit 1
}

# Corre el orquestador; todo (stdout+stderr) va al log en UTF-8 (el redirect
# nativo *>> de PowerShell 5.1 escribe UTF-16 y queda ilegible).
& $node "scripts\refresh-catalog.mjs" *>&1 | Out-File -FilePath $log -Encoding utf8 -Append
$code = $LASTEXITCODE

# Poda: dejamos los últimos 30 logs.
Get-ChildItem $logDir -Filter "refresh-*.log" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
