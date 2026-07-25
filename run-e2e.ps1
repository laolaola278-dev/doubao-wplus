Set-Location D:\xjx\MCP\doubao-wplus
& node node_modules/@playwright/test/cli.js test tests/e2e/extension-load.spec.ts --reporter=list *>&1 | Out-File -FilePath playwright-results/last-run.log -Encoding utf8
