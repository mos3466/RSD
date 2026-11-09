@echo off
setlocal
cd /d "%~dp0.."

if "%RSD_API_URL%"=="" (
  echo Missing RSD_API_URL. Example: set RSD_API_URL=https://your-rsd-host.example
  exit /b 1
)
if "%RSD_BRIDGE_API_KEY%"=="" (
  echo Missing RSD_BRIDGE_API_KEY. Set the same server-side bridge key before running.
  exit /b 1
)
if "%RSD_SERIAL_PORT%"=="" set "RSD_SERIAL_PORT=COM3"
if "%RSD_SERIAL_BAUD%"=="" set "RSD_SERIAL_BAUD=115200"

python hardware\rfid_bridge.py --port "%RSD_SERIAL_PORT%" --baud "%RSD_SERIAL_BAUD%"
if errorlevel 1 pause
