@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -Command "$vbs = \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\StarWhisperCloudTunnel.vbs\"; $pyw = 'C:\Program Files\Python311\pythonw.exe'; if (-not (Test-Path $pyw)) { $pyw = (Get-Command pythonw -ErrorAction SilentlyContinue).Source }; @\"
Set WshShell = CreateObject(\"WScript.Shell\")
WshShell.CurrentDirectory = \"$PWD\"
WshShell.Run \"\"\"$pyw\"\" \"\"$PWD\scripts\start-cloud-tunnel.py\"\"\", 0, False
\"@ | Set-Content -Encoding Unicode -Path $vbs; Start-Process wscript.exe \"`\"$vbs`\"\""
echo [成功] 已开启 Windows 开机静默自启，并已启动后台隧道守护（无黑框）。
pause
