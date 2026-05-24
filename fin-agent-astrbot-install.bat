@echo off
setlocal enabledelayedexpansion

::=============================================================================
:: fin-agent-astrbot-install.bat
:: 将 fin-agent MCP Server 接入 AstrBot (Windows)
::
:: 使用方式: fin-agent-astrbot-install.bat [--uninstall] [--astrbot-data PATH]
::=============================================================================

set "MCP_SERVER_NAME=fin-agent"
set "SCRIPT_DIR=%~dp0"

:: 默认值
set "ASTRBOT_ROOT="
set "ACTION=install"

:: 解析参数
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="--uninstall" set "ACTION=uninstall" & shift & goto :parse_args
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
call :install
goto :end

::=============================================================================
:: 显示帮助
::=============================================================================
:show_help
echo Usage: fin-agent-astrbot-install.bat [OPTIONS]
echo.
echo OPTIONS:
echo   --astrbot-data PATH   AstrBot 数据目录 (默认: 自动检测)
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
    set "ASTRBOT_DATA=%ASTRBOT_ROOT%\data"
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
set "MCP_SERVER_SOURCE=%SCRIPT_DIR%fin-agent-mcp-server"
set "MCP_SERVER_DIST=%MCP_SERVER_SOURCE%\dist\index.js"
set "SKILL_SOURCE_BASE=%SCRIPT_DIR%fin-agent-skill"

:: [1/5] 构建 MCP Server
echo [1/5] 检查 fin-agent-mcp-server ...
if not exist "%MCP_SERVER_DIST%" (
    echo       构建中...
    if not exist "%MCP_SERVER_SOURCE%\package.json" (
        echo ERROR: fin-agent-mcp-server 未找到: %MCP_SERVER_SOURCE%
        exit /b 1
    )
    pushd "%MCP_SERVER_SOURCE%"
    call npm install --silent 2>nul || call npm install
    call npm run build
    popd
    echo       构建完成
) else (
    echo       已构建，跳过
)
echo.

:: [2/6] 复制 .env 配置文件
echo [2/6] 复制 .env 配置文件 ...
if exist "%MCP_SERVER_SOURCE%\.env" (
    copy /Y "%MCP_SERVER_SOURCE%\.env" "%ASTRBOT_DATA%\.env" >nul
    echo       .env -^> %ASTRBOT_DATA%\.env
    echo       .env 配置复制完成
) else (
    echo       .env 文件不存在，跳过
)
echo.

:: [3/6] 安装 3 个 Skills
echo [3/6] 安装 fin-agent Skills ...
:: 清理旧版单一 skill
if exist "%ASTRBOT_DATA%\skills\fin-agent" rmdir /S /Q "%ASTRBOT_DATA%\skills\fin-agent"
:: 安装 3 个新版 skill
for %%S in (market-briefing stock-deep fin-review position-watch) do (
    set "src=%SCRIPT_DIR%fin-agent-skill\%%S\SKILL.md"
    set "dst=%ASTRBOT_DATA%\skills\%%S\SKILL.md"
    if not exist "!src!" (
        echo       警告: !src! 不存在，跳过
    ) else (
        if not exist "%ASTRBOT_DATA%\skills\%%S" mkdir "%ASTRBOT_DATA%\skills\%%S"
        copy /Y "!src!" "!dst!" >nul
        echo       %%S\SKILL.md -^> %ASTRBOT_DATA%\skills\%%S\SKILL.md
    )
)
echo       4 个 Skill 安装完成
echo.

:: [4/6] 配置 MCP Server
echo [4/6] 配置 MCP Server 连接 ...
call :configure_mcp
echo       MCP Server 配置完成
echo.

:: [5/6] 验证
echo [5/6] 验证配置 ...
if not exist "%MCP_SERVER_DIST%" (
    echo ERROR: MCP Server 未构建
    exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: node 未找到
    exit /b 1
)
echo       验证通过
echo.

:: [6/6] 完成
echo [6/6] 完成!
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
:: 卸载流程
::=============================================================================
:uninstall
echo ============================================
echo   卸载 fin-agent ^(停止接入 AstrBot^)
echo ============================================
echo.

call :detect_data

set "MCP_SERVERS_FILE=%ASTRBOT_DATA%\mcp_server.json"
set "SKILL_TARGET_DIR=%ASTRBOT_DATA%\skills\fin-agent"

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
for %%S in (fin-agent market-briefing stock-deep fin-review position-watch) do (
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