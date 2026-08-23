@echo off
chcp 65001 >nul
cd /d %~dp0
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
call npm --silent run sync
if %errorlevel% neq 0 (echo 同步失败 & exit /b 1)
git add data
git diff --cached --quiet
if %errorlevel%==0 (echo 数据无变化 & exit /b 0)
for /f "tokens=1,2" %%i in ('powershell -command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set STAMP=%%i %%j
git commit -m "数据同步 %STAMP%"
git push
echo 已推送
