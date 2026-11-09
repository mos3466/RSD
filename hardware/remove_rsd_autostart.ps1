$ErrorActionPreference = "Stop"
$taskName = "RSD RFID Bridge"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed the RSD RFID Bridge scheduled task. Existing configuration was left intact." -ForegroundColor Yellow
