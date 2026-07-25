@echo off
cd /d D:\xjx\MCP\doubao-wplus
npx playwright test tests/e2e/extension-load.spec.ts --reporter=list > playwright-results\last-run.log 2>&1
exit /b %ERRORLEVEL%
