@echo off
title Clean TV Cast — PC to Samsung Smart TV
cd /d "%~dp0"
netstat -ano | findstr ":5050 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:5050/cast.html
  exit /b 0
)
start "" http://localhost:5050/cast.html
node server.mjs %*
