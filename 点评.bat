@echo off
chcp 65001 >nul
title 作者复盘编辑器
cd /d %~dp0
echo 正在启动点评工具，浏览器将自动打开…
node scripts/review-server.mjs
pause
