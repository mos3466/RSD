$ErrorActionPreference = "Stop"
$configPath = Join-Path $env:LOCALAPPDATA "RSD\rfid_bridge.config.json"
$logPath = Join-Path $env:LOCALAPPDATA "RSD\rfid_bridge.log"

if (-not (Test-Path $configPath)) {
  throw "RSD is not configured yet. Run hardware\\setup_rsd_autostart.ps1 once."
}

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$secureKey = ConvertTo-SecureString $config.keyEncrypted
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $env:RSD_API_URL = [string]$config.apiUrl
  $env:RSD_BRIDGE_API_KEY = $plainKey
  $env:RSD_SERIAL_PORT = [string]$config.serialPort
  $env:RSD_SERIAL_BAUD = [string]$config.baud
  $env:RSD_SCAN_DIRECTION = [string]$config.direction
  $env:RSD_LOCK_PATH = Join-Path $env:LOCALAPPDATA "RSD\rfid_bridge.lock"
  $projectRoot = [string]$config.projectRoot
  Set-Location $projectRoot
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null

  # Prefer the Python launcher, then fall back to python.exe. The key is passed
  # only as an environment variable and never appears in this command line.
  # Python writes API/connection diagnostics to stderr; keep those diagnostics
  # in the log without letting Windows PowerShell terminate the bridge process.
  $ErrorActionPreference = "Continue"
  $python = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($python) {
    & $python.Source -3 "$projectRoot\hardware\rfid_bridge.py" >> $logPath 2>&1
  } else {
    & python.exe "$projectRoot\hardware\rfid_bridge.py" >> $logPath 2>&1
  }
  exit $LASTEXITCODE
}
finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $plainKey = $null
}
