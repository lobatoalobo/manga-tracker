# Registra (o reemplaza) la tarea programada que actualiza el catálogo todos los
# días. Idempotente: corrélo de nuevo para cambiar la hora.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-refresh-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-refresh-task.ps1 -At 04:30
#
# Si Register-ScheduledTask pide permisos, abrí PowerShell como Administrador.

param(
  [string]$At = "03:00",
  [string]$TaskName = "NakamaCatalogRefresh"
)

$root = Split-Path -Parent $PSScriptRoot
$ps1 = Join-Path $root "scripts\refresh-catalog.ps1"
if (-not (Test-Path $ps1)) { throw "No se encontró $ps1" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`"" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $At

# StartWhenAvailable: si la PC estaba apagada a la hora, lo corre apenas pueda.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Actualiza el catálogo de Nakama (Ivrea + Whakoom + enrich) contra producción." `
  -Force | Out-Null

Write-Host "OK - Tarea '$TaskName' registrada: diaria a las $At."
Write-Host "  Probarla ahora:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Ver estado:      Get-ScheduledTaskInfo -TaskName $TaskName"
Write-Host "  Logs:            $root\logs\refresh-*.log"
Write-Host ("  Quitarla:        Unregister-ScheduledTask -TaskName $TaskName -Confirm:" + '$false')
