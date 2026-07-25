Set-Location D:\xjx\MCP\doubao-wplus
$env:DOUBAO_WPLUS_E2E = '1'
& node node_modules/wxt/bin/wxt.mjs build *>&1 | Out-File -FilePath playwright-results/build.log -Encoding utf8
