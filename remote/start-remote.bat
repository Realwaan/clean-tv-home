@echo off
title Clean TV Remote — Samsung Smart TV
cd /d "%~dp0"
netstat -ano | findstr ":5050 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:5050
  exit /b 0
)
start "" http://localhost:5050
node server.mjs %*
