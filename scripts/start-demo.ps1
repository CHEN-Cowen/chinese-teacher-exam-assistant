# 独立本机演示，所有业务数据留在浏览器；不使用线上账号或数据库。
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$env:NEXT_PUBLIC_APP_ENV = 'demo'
$env:NEXT_PUBLIC_AUTH_MODE = 'demo'
$env:NEXT_PUBLIC_DEMO_MODE = 'true'
$env:NEXT_PUBLIC_FF_NEW_RESULTS = 'true'
$env:NEXT_PUBLIC_FF_POST_SAVE_NEXT = 'true'
$env:NEXT_PUBLIC_FF_TARGETED_SUPPLEMENT = 'true'
npm run dev -- --port 3100 --hostname 127.0.0.1 --webpack
