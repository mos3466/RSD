@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_rsd_bridge.ps1"
if errorlevel 1 (
  echo.
  echo RSD RFID bridge stopped with an error. Check %%LOCALAPPDATA%%\RSD\rfid_bridge.log
  pause
)
