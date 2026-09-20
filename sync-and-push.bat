@echo off
chcp 65001 >nul
cd /d %~dp0

REM .env 由 PowerShell 逐行解析：.bat 的 for/set 会把值里的 & 和 | 当成命令分隔符执行，
REM 用 PowerShell 解析再在同一进程里设置变量，特殊字符不会被当成命令。
if not exist ".env" (echo 未找到 .env 配置 & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$envFile = Join-Path $PWD '.env'; foreach ($line in [IO.File]::ReadAllLines($envFile)) { $s = $line.Trim(); if ($s -eq '' -or $s.StartsWith('#')) { continue }; $i = $s.IndexOf('='); if ($i -lt 1) { continue }; $k = $s.Substring(0, $i).Trim(); $v = $s.Substring($i + 1).Trim().Trim('\"'); if ($v) { [Environment]::SetEnvironmentVariable($k, $v, 'Process') } }; npm --silent run sync; exit $LASTEXITCODE"
if %errorlevel% neq 0 (echo 同步失败 & exit /b 1)

git add data
git diff --cached --quiet
if %errorlevel%==0 (echo 数据无变化 & exit /b 0)
for /f "tokens=1,2" %%i in ('powershell -command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set STAMP=%%i %%j
git commit -m "数据同步 %STAMP%"
git push
echo 已推送
