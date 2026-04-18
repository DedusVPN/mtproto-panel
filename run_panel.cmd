@echo off
cd /d "%~dp0"
if "%PANEL_BIND_HOST%"=="" set PANEL_BIND_HOST=0.0.0.0
if "%PANEL_BIND_PORT%"=="" set PANEL_BIND_PORT=8765
uv run python -m uvicorn app.main:app --host %PANEL_BIND_HOST% --port %PANEL_BIND_PORT%
