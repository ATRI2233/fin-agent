@echo off
echo OpenCode FinAgent Plugin - Uninstall
echo ====================================
echo.

set PROJECT_ROOT=%CD%

echo Step 1: Removing agent definition files...
if exist ".opencode\agents\fin-orchestrator.md" del /q ".opencode\agents\fin-orchestrator.md" && echo   Removed: fin-orchestrator.md
if exist ".opencode\agents\macro-scout.md" del /q ".opencode\agents\macro-scout.md" && echo   Removed: macro-scout.md
if exist ".opencode\agents\sector-rotator.md" del /q ".opencode\agents\sector-rotator.md" && echo   Removed: sector-rotator.md
if exist ".opencode\agents\sentiment-decoder.md" del /q ".opencode\agents\sentiment-decoder.md" && echo   Removed: sentiment-decoder.md
if exist ".opencode\agents\technical-chartist.md" del /q ".opencode\agents\technical-chartist.md" && echo   Removed: technical-chartist.md
if exist ".opencode\agents\fundamental-auditor.md" del /q ".opencode\agents\fundamental-auditor.md" && echo   Removed: fundamental-auditor.md
if exist ".opencode\agents\smart-money-hound.md" del /q ".opencode\agents\smart-money-hound.md" && echo   Removed: smart-money-hound.md
if exist ".opencode\agents\risk-gatekeeper.md" del /q ".opencode\agents\risk-gatekeeper.md" && echo   Removed: risk-gatekeeper.md
if exist ".opencode\agents\fusion-brain.md" del /q ".opencode\agents\fusion-brain.md" && echo   Removed: fusion-brain.md
echo.

echo Step 2: Removing skill definitions...
if exist ".opencode\skills\fin-analysis-workflow" rmdir /s /q ".opencode\skills\fin-analysis-workflow" && echo   Removed: fin-analysis-workflow
echo.

echo Step 3: Note about opencode.json
echo   Please manually remove the following from opencode.json:
echo   - MCP servers: fin-agent-mcp-server, fred-mcp-server, ashare-mcp-server, risk-mcp-server, sec-edgar-mcp
echo   - Agents: fin-orchestrator, macro-scout, sector-rotator, sentiment-decoder, technical-chartist, fundamental-auditor, smart-money-hound, risk-gatekeeper, fusion-brain
echo   - Skills: fin-analysis-workflow
echo.

echo ====================================
echo Uninstall complete!
echo.
echo Please restart opencode for changes to take effect.
pause
