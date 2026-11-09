[CmdletBinding()]
param(
  [string]$ApiUrl = "https://rasd-metro-be5rjq3l.manus.space",
  [string]$SerialPort = "",
  [ValidateSet("entry", "exit")]
  [string]$Direction = "entry"
)

$ErrorActionPreference = "Stop"
$hardwareDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $hardwareDir
$configDir = Join-Path $env:LOCALAPPDATA "RSD"
$configPath = Join-Path $configDir "rfid_bridge.config.json"
$taskName = "RSD RFID Bridge"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

Write-Host "RSD RFID automatic startup setup" -ForegroundColor Green
Write-Host "Backend: $ApiUrl"
if ($SerialPort) { Write-Host "Serial port: $SerialPort" } else { Write-Host "Serial port: automatic Arduino/CH340 detection" }

$key = Read-Host "Paste the existing RSD_BRIDGE_API_KEY (input is hidden)" -AsSecureString
if (-not $key -or $key.Length -eq 0) { throw "A bridge key is required." }

# DPAPI CurrentUser encryption: only this Windows user can decrypt the key.
$keyEncrypted = ConvertFrom-SecureString -SecureString $key
$config = [ordered]@{
  apiUrl = $ApiUrl.TrimEnd('/')
  serialPort = $SerialPort
  baud = 115200
  direction = $Direction
  keyEncrypted = $keyEncrypted
  projectRoot = $projectRoot
}
$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

$startScript = Join-Path $hardwareDir "start_rsd_bridge.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Ignore -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Installed successfully." -ForegroundColor Green
Write-Host "Config (DPAPI protected): $configPath"
Write-Host "Task Scheduler task: $taskName"
Write-Host "The bridge will start at the next Windows sign-in and wait for Arduino if it is unplugged."
Write-Host "Run hardware\\Start RASD.bat when you want to start it manually now."
