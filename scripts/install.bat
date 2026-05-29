@echo off
setlocal enabledelayedexpansion

::=============================================================================
:: scripts/install.bat (formerly fin-agent/scripts/install.bat)
:: 将 FinAgent MCP Server 接入 AstrBot (Windows)
::
:: 使用方式: install.bat [--uninstall] [--astrbot-data PATH]
::=============================================================================

set "MCP_SERVER_NAME=fin-agent"
set "SCRIPT_DIR=%~dp0"
set "FIN_AGENT_ROOT=%~dp0.."

:: 默认值
set "ASTRBOT_ROOT="
set "ACTION=install"

:: 解析参数
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="--uninstall" set "ACTION=uninstall" & shift & goto :parse_args
if /i "%~1"=="--update" set "ACTION=update" & shift & goto :parse_args
if /i "%~1"=="--astrbot-data" (
    set "ASTRBOT_ROOT=%~2"
    shift & shift & goto :parse_args
)
echo ERROR: 未知参数: %~1
exit /b 1

:args_done

::=============================================================================
:: 主入口
::=============================================================================
if /i "%ACTION%"=="uninstall" call :uninstall & goto :end
if /i "%ACTION%"=="update" call :update & goto :end
call :install
goto :end

::=============================================================================
:: 显示帮助
::=============================================================================
:show_help
echo Usage: install.bat [OPTIONS]
echo.
echo OPTIONS:
echo   --astrbot-data PATH   AstrBot 数据目录 (默认: 自动检测)
echo   --update              更新 fin-agent ^(重建 + 更新配置, 保留 .env^)
echo   --uninstall           卸载 fin-agent ^(停止接入^)
echo   --help                显示帮助
echo.
echo 自动检测顺序:
echo   1. ASTRBOT_ROOT 环境变量
echo   2. %%USERPROFILE%%\.astrbot
echo   3. 当前工作目录下的 data\ 目录
echo.
exit /b 0

::=============================================================================
:: 检测 AstrBot 数据目录
::=============================================================================
:detect_data
if not "%ASTRBOT_ROOT%"=="" (
    set "ASTRBOT_DATA=%ASTRBOT_ROOT%"
    exit /b 0
)

:: 尝试顺序检测
set "CAND1=%USERPROFILE%\.astrbot\data"
set "CAND2=%CD%\data"

if exist "%CAND1%" (
    set "ASTRBOT_DATA=%CAND1%"
    exit /b 0
)
if exist "%CAND2%" (
    set "ASTRBOT_DATA=%CAND2%"
    exit /b 0
)

echo ERROR: 无法自动检测 AstrBot 数据目录
echo 请使用 --astrbot-data 指定目录
exit /b 1

::=============================================================================
:: 安装流程
::=============================================================================
:install
echo ============================================
echo   fin-agent 接入 AstrBot 安装程序
echo ============================================
echo.

call :detect_data
if errorlevel 1 exit /b 1
echo AstrBot 数据目录: %ASTRBOT_DATA%
echo.

set "MCP_SERVERS_FILE=%ASTRBOT_DATA%\mcp_server.json"
set "MCP_SERVER_SOURCE=%FIN_AGENT_ROOT%\mcp-server"
set "FRED_MCP_SOURCE=%FIN_AGENT_ROOT%\mcp-servers\fred"
set "RISK_MCP_SOURCE=%FIN_AGENT_ROOT%\mcp-servers\risk\risk_mcp_server.py"
set "ASHARE_MCP_SOURCE=%FIN_AGENT_ROOT%\mcp-servers\ashare\ashare_mcp_server.py"

:: [1/6] 检查并安装 Python 依赖
echo [1/6] 检查 Python 依赖 ...
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: python 未找到，请先安装 Python
    exit /b 1
)
echo       Python 已找到
echo.

:: [2/6] 安装 MCP Server 依赖
echo [2/6] 安装 MCP Server 依赖 ...
if exist "%MCP_SERVER_SOURCE%\package.json" (
    pushd "%MCP_SERVER_SOURCE%"
    call npm install --silent --include=dev 2>nul || call npm install --include=dev
    call npm run build
    popd
    echo       MCP Server 依赖安装完成
) else (
    echo       mcp-server 目录不存在，跳过
)
echo.

:: [3/6] 安装 FRED MCP Server
echo [3/6] 安装 FRED MCP Server ...
if exist "%FRED_MCP_SOURCE%\package.json" (
    pushd "%FRED_MCP_SOURCE%"
    call npm install --silent --include=dev 2>nul || call npm install --include=dev
    call npm run build
    popd
    echo       FRED MCP Server 依赖安装完成
) else (
    echo       fred 目录不存在，跳过
)
echo.

:: [4/6] 安装 Skills
echo [4/6] 安装 fin-agent Skills ...
for %%S in (market-briefing stock-deep fin-review position-watch) do (
    set "src=%FIN_AGENT_ROOT%\%%S\SKILL.md"
    set "dst=%ASTRBOT_DATA%\skills\%%S\SKILL.md"
    if not exist "!src!" (
        echo       警告: !src! 不存在，跳过
    ) else (
        if not exist "%ASTRBOT_DATA%\skills\%%S" mkdir "%ASTRBOT_DATA%\skills\%%S"
        copy /Y "!src!" "!dst!" >nul
        echo       %%S\SKILL.md -^> %ASTRBOT_DATA%\skills\%%S\SKILL.md
    )
)
echo       Skills 安装完成
echo.

:: [5/6] 配置 MCP Server
echo [5/6] 配置 MCP Server 连接 ...
call :configure_mcp
echo       MCP Server 配置完成
echo.

:: [6/6] 验证
echo [6/6] 验证配置 ...
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: node 未找到
    exit /b 1
)
echo       验证通过
echo.

echo ============================================
echo   接入完成，重启 AstrBot 后生效
echo ============================================
echo.
echo 可用技能 ^(在 AstrBot 中发送消息^):
echo.
echo   【market-briefing】大盘快报
echo     - 分析今日市场  /  大盘怎么样
echo.
echo   【stock-deep】个股深度
echo     - 分析 AAPL  /  TSLA 怎么样
echo.
echo   【fin-review】周度复盘
echo     - 本周总结  /  看看准确率
echo.
echo   【position-watch】持仓盯盘
echo     - 看看我的持仓  /  盯盘
echo.
goto :end

::=============================================================================
:: 配置 mcp_server.json
::=============================================================================
:configure_mcp
set "MCP_SERVER_DIST=%MCP_SERVER_SOURCE%\dist\index.js"
set "NODE_PATH=%MCP_SERVER_DIST:\=/%"

if not exist "%MCP_SERVERS_FILE%" (
    :: 新建文件
    powershell -NoProfile -Command ^
        "$svr=@{command='node'; args=@('%MCP_SERVER_DIST:\=/%'); env=@{FINNHUB_API_KEY=($env:FINNHUB_API_KEY).Trim(); FRED_API_KEY=($env:FRED_API_KEY).Trim(); OILPRICE_API_KEY=($env:OILPRICE_API_KEY).Trim(); OILPRICEAPI_KEY=($env:OILPRICE_API_KEY).Trim(); HTTP_PROXY=($env:HTTP_PROXY).Trim(); HTTPS_PROXY=($env:HTTPS_PROXY).Trim()}}; " ^
        "@{mcpServers=@{'%MCP_SERVER_NAME%'=$svr}} | ConvertTo-Json -Depth 10 | Set-Content '%MCP_SERVERS_FILE%'"
    goto :configure_done
)

:: 检查是否已存在
findstr /C:"\"%MCP_SERVER_NAME%\"" "%MCP_SERVERS_FILE%" >nul 2>&1
if not errorlevel 1 (
    echo       fin-agent 已存在于 mcp_server.json，跳过
    goto :configure_done
)

:: 使用 PowerShell 合并 JSON（兼容 PS 5.x）
set "FIN_AGENT_PATH=!NODE_PATH!"
powershell -NoProfile -Command ^
    "$json = Get-Content '%MCP_SERVERS_FILE%' -Raw | ConvertFrom-Json; " ^
    "if (-not $json.mcpServers) { $json = $json | Add-Member -Name mcpServers -Value @{} -MemberType NoteProperty -PassThru }; " ^
    "$svr = @{command='node'; args=@($env:FIN_AGENT_PATH); env=@{FINNHUB_API_KEY=($env:FINNHUB_API_KEY).Trim(); FRED_API_KEY=($env:FRED_API_KEY).Trim(); OILPRICE_API_KEY=($env:OILPRICE_API_KEY).Trim(); OILPRICEAPI_KEY=($env:OILPRICE_API_KEY).Trim(); HTTP_PROXY=($env:HTTP_PROXY).Trim(); HTTPS_PROXY=($env:HTTPS_PROXY).Trim()}}; " ^
    "$json.mcpServers | Add-Member -Name '%MCP_SERVER_NAME%' -Value $svr -MemberType NoteProperty -Force; " ^
    "$json | ConvertTo-Json -Depth 10 | Set-Content '%MCP_SERVERS_FILE%'"
set "FIN_AGENT_PATH="

:configure_done
exit /b 0

::=============================================================================
:: 更新流程（保留 .env，只重建 + 更新 mcp_server.json + skills）
::=============================================================================
:update
echo ============================================
echo   fin-agent 更新模式
echo ============================================
echo.

call :detect_data
if errorlevel 1 exit /b 1
echo AstrBot 数据目录: %ASTRBOT_DATA%
echo.

set "MCP_SERVERS_FILE=%ASTRBOT_DATA%\mcp_server.json"
set "MCP_SERVER_SOURCE=%FIN_AGENT_ROOT%\mcp-server"

:: [1] 重建 fin-agent-mcp-server
echo [1/3] 重建 fin-agent-mcp-server ...
if exist "%MCP_SERVER_SOURCE%\package.json" (
    pushd "%MCP_SERVER_SOURCE%"
    call npm install --silent --include=dev 2>nul || call npm install --include=dev
    call npm run build
    popd
    echo       MCP Server 重建完成
)
echo.

:: [2] 配置 MCP Server（保留 .env 中已有的密钥）
echo [2/3] 更新 MCP Server 配置 ...
call :update_mcp_config
echo.

:: [3] 复制 Skills
echo [3/3] 更新 Skills ...
for %%S in (market-briefing stock-deep fin-review position-watch) do (
    set "src=%FIN_AGENT_ROOT%\skill\%%S\SKILL.md"
    set "dst=%ASTRBOT_DATA%\skills\%%S\SKILL.md"
    if not exist "!src!" (
        echo       警告: !src! 不存在，跳过
    ) else (
        if not exist "%ASTRBOT_DATA%\skills\%%S" mkdir "%ASTRBOT_DATA%\skills\%%S"
        copy /Y "!src!" "!dst!" >nul
        echo       %%S - 已更新
    )
)
echo.

echo ============================================
echo   更新完成，重启 AstrBot 后生效
echo ============================================
echo.
goto :end

:: 更新 mcp_server.json（保留已有 env）
:update_mcp_config
set "MCP_SERVER_DIST=%MCP_SERVER_SOURCE%\dist\index.js"
set "NODE_PATH=%MCP_SERVER_DIST:\=/%"

powershell -NoProfile -Command ^
    "$json = if (Test-Path '%MCP_SERVERS_FILE%') { Get-Content '%MCP_SERVERS_FILE%' -Raw | ConvertFrom-Json } else { @{mcpServers=@{}} }; " ^
    "if (-not $json.mcpServers) { $json = $json | Add-Member -Name mcpServers -Value @{} -MemberType NoteProperty -PassThru }; " ^
    "$existingEnv = if ($json.mcpServers.'%MCP_SERVER_NAME%' -and $json.mcpServers.'%MCP_SERVER_NAME%'.env) { $json.mcpServers.'%MCP_SERVER_NAME%'.env } else { @{} }; " ^
    "$svr = @{command='node'; args=@('%MCP_SERVER_DIST:\=/%'); env=@{FINNHUB_API_KEY=($existingEnv.FINNHUB_API_KEY); FRED_API_KEY=($existingEnv.FRED_API_KEY); OILPRICE_API_KEY=($existingEnv.OILPRICE_API_KEY); OILPRICEAPI_KEY=($existingEnv.OILPRICEAPI_KEY); HTTP_PROXY=($existingEnv.HTTP_PROXY); HTTPS_PROXY=($existingEnv.HTTPS_PROXY)}}; " ^
    "$json.mcpServers | Add-Member -Name '%MCP_SERVER_NAME%' -Value $svr -MemberType NoteProperty -Force; " ^
    "$json | ConvertTo-Json -Depth 10 | Set-Content '%MCP_SERVERS_FILE%'"
echo       mcp_server.json 已更新（保留已有密钥）
exit /b 0

::=============================================================================
:: 卸载流程
::=============================================================================
:uninstall
echo ============================================
echo   卸载 fin-agent ^(停止接入 AstrBot^)
echo ============================================
echo.

call :detect_data

set "MCP_SERVERS_FILE=%ASTRBOT_DATA%\mcp_server.json"

:: 从 mcp_server.json 移除
if exist "%MCP_SERVERS_FILE%" (
    findstr /C:"\"%MCP_SERVER_NAME%\"" "%MCP_SERVERS_FILE%" >nul 2>&1
    if not errorlevel 1 (
        set "FIN_AGENT_PATH=!NODE_PATH!"
        powershell -NoProfile -Command ^
            "$json = Get-Content '%MCP_SERVERS_FILE%' -Raw | ConvertFrom-Json; " ^
            "if ($json.mcpServers.'%MCP_SERVER_NAME%') { $json.mcpServers.PSObject.Properties.Remove('%MCP_SERVER_NAME%') }; " ^
            "$json | ConvertTo-Json -Depth 10 | Set-Content '%MCP_SERVERS_FILE%'"
        set "FIN_AGENT_PATH="
        echo 已从 mcp_server.json 移除 fin-agent
    ) else (
        echo mcp_server.json 中未找到 fin-agent
    )
) else (
    echo mcp_server.json 不存在
)
echo.

:: 删除所有 Skill
for %%S in (market-briefing stock-deep fin-review position-watch) do (
    set "dir=%ASTRBOT_DATA%\skills\%%S"
    if exist "!dir!" (
        rmdir /S /Q "!dir!"
        echo 已删除 !dir!
    )
)
echo.

echo 卸载完成，重启 AstrBot 后生效
goto :end

::=============================================================================
:: 主流程
::=============================================================================
:end
endlocal
exit /b 0