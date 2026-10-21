@echo off
echo Starting VRChat Control System...
echo.
node cleanup_port.js
timeout /t 2 /nobreak >nul
echo.
echo Starting Discord Bot...
cd ../..
node index.js
pause