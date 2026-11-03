@echo off
chcp 65001 >nul
cd /d %~dp0

REM .env 由 scripts/fetch.mjs 自己逐行读取（不经 shell），值里的 & | 等特殊字符不会被当作命令分隔符，
REM 因此这里不再用 PowerShell 预解析（那段内联命令的 \" 转义在 cmd 里脆弱，已移除）。
REM 若要临时改用其他代理端口：set BITGET_PROXY=http://127.0.0.1:10808 后再运行本脚本。
if not exist ".env" (echo 未找到 .env 配置 & exit /b 1)
npm --silent run sync
if %errorlevel% neq 0 (echo 同步失败 & exit /b 1)

git add data
git diff --cached --quiet
if %errorlevel%==0 (echo 数据无变化 & exit /b 0)
for /f "tokens=1,2" %%i in ('powershell -command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set STAMP=%%i %%j
git commit -m "数据同步 %STAMP%"
git push
echo 已推送
