@echo off
chcp 65001 >nul
set "STARTUP_VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\StarWhisperCloudTunnel.vbs"
if exist "%STARTUP_VBS%" del /f /q "%STARTUP_VBS%"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -match '^(node|python)') -and ($_.CommandLine -match 'localBridgeDaemon|start-cloud-tunnel') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo [成功] 已关闭开机自启并停止后台隧道进程。
pause
