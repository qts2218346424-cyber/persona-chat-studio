@echo off
chcp 65001 >nul
set "STARTUP_VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\StarWhisperCloudTunnel.vbs"
if exist "%STARTUP_VBS%" (
  del /f /q "%STARTUP_VBS%"
  echo [成功] 已关闭 Windows 开机自启（已删除自启项）。
) else (
  echo [提示] 当前未配置开机自启项，无需删除。
)
pause
