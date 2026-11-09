@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if exist .env (
  echo .env already exists; leaving it unchanged.
) else (
  copy /y env.example .env >nul
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-Content .env -Raw; $jwt=[Convert]::ToBase64String((1..48|ForEach-Object {Get-Random -Maximum 256})); $bridge=[Convert]::ToBase64String((1..32|ForEach-Object {Get-Random -Maximum 256})); $p=$p -replace 'JWT_SECRET=',('JWT_SECRET='+$jwt) -replace 'RSD_BRIDGE_API_KEY=',('RSD_BRIDGE_API_KEY='+$bridge); Set-Content -Encoding utf8 .env $p"
  echo Created .env with local random JWT and RFID bridge secrets.
)

echo.
echo Next required action: set DATABASE_URL in .env to a real MySQL/TiDB connection string.
echo OAuth app credentials (VITE_APP_ID and OWNER_OPEN_ID) are required for sign-in.
echo Never commit or share .env.
echo.
echo Run: pnpm install
 echo Run: pnpm dev
endlocal
