@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   星语恋庭 · 云端直连本机 Antigravity / Gemini 桥接隧道
echo   保持此窗口开启，云端网站即可直连你电脑上的大模型配额
echo ========================================================
echo.
python scripts\start-cloud-tunnel.py
pause
