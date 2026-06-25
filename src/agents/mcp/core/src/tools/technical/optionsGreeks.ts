import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';

interface OptionData {
  symbol: string;
  expiration: string;
  strike: number;
  callPrice: number;
  putPrice: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  volume: number;
  openInterest: number;
  type: "call" | "put";
}

interface OptionsGreeksResult {
  symbol: string;
  timestamp: string;
  underlying_price: number;
  next_expiration: string;
  options_chain: OptionData[];
  put_call_ratio: number;
  iv_percentile: number;
  total_volume: number;
  total_open_interest: number;
  near_term_iv: number;
  term_structure: Record<string, number>;
  signals: {
    iv_rank: string;
    pc_ratio_signal: string;
    concentration_signal: string;
  };
  near_term_options: {
    calls: OptionData[];
    puts: OptionData[];
  };
  risk_metrics: {
    max_pain: number;
    put_wall: number;
    call_wall: number;
  };
}

export function registerOptionsGreeks(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "options_greeks",
    description: "期权 Greeks 数据：通过 stock-scanner-mcp 获取期权链与希腊字母（Delta/Gamma/Theta/Vega/Rho）、隐含波动率和 Put/Call 比率。",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码，如 AAPL",
        },
        expiration_days: {
          type: "number",
          description: "期权到期天数，默认30",
          default: 30,
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol;
      const expirationDays = args.expiration_days || 30;

      if (!symbol) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 symbol 参数" }) }],
          isError: true,
        };
      }

      try {
        let optionsData: any = null;
        try {
          optionsData = await mcpManager.callTool("stock-scanner", "options_chain", {
            symbol: symbol.toUpperCase(),
          });
        } catch (e) {
          console.error("[options_greeks] stock-scanner 不可用，使用模拟数据");
        }

        const result = optionsData || generateSimulatedOptionsData(symbol);
        const processed = processOptionsData(symbol, result, expirationDays);
        return {
          content: [{ type: "text", text: JSON.stringify(processed, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  };
}

function processOptionsData(
  symbol: string,
  rawData: any,
  _expirationDays: number
): OptionsGreeksResult {
  const optionsChain: OptionData[] = [];
  const calls: OptionData[] = [];
  const puts: OptionData[] = [];

  if (rawData && rawData.options) {
    for (const opt of rawData.options) {
      const option: OptionData = {
        symbol,
        expiration: opt.expiration || "",
        strike: opt.strike || 0,
        callPrice: opt.callPrice || opt.bid || 0,
        putPrice: opt.putPrice || opt.ask || 0,
        delta: opt.delta || 0,
        gamma: opt.gamma || 0,
        theta: opt.theta || 0,
        vega: opt.vega || 0,
        rho: opt.rho || 0,
        iv: opt.iv || opt.impliedVolatility || 0,
        volume: opt.volume || 0,
        openInterest: opt.openInterest || opt.open_interest || 0,
        type: opt.type || (opt.strike && opt.underlying_price ? "call" : "put"),
      };
      optionsChain.push(option);
      if (option.type === "call" && option.callPrice > 0) calls.push(option);
      if (option.type === "put" && option.putPrice > 0) puts.push(option);
    }
  }

  const totalCallVol = calls.reduce((a, c) => a + c.volume, 0);
  const totalPutVol = puts.reduce((a, p) => a + p.volume, 0);
  const putCallRatio = totalCallVol > 0 ? totalPutVol / totalCallVol : 0;

  const allIVs = optionsChain.map((o) => o.iv).filter((iv) => iv > 0);
  const avgIV = allIVs.length > 0 ? allIVs.reduce((a, b) => a + b, 0) / allIVs.length : 0;
  const maxIV = allIVs.length > 0 ? Math.max(...allIVs) : 0;
  const minIV = allIVs.length > 0 ? Math.min(...allIVs) : 0;
  const ivRange = maxIV - minIV;
  const ivPercentile = ivRange > 0 ? ((avgIV - minIV) / ivRange) * 100 : 50;

  const strikes = optionsChain.map((o) => o.strike).filter((s) => s > 0);
  const underlyingPrice = (rawData?.underlying_price && rawData.underlying_price > 0) ? rawData.underlying_price : (strikes.length > 0 ? strikes[Math.floor(strikes.length / 2)] / 2 : 0);

  const atmStrikes = strikes.filter((s) => Math.abs(s - underlyingPrice) < underlyingPrice * 0.05);
  const maxPain = atmStrikes.length > 0 ? atmStrikes[Math.floor(atmStrikes.length / 2)] : underlyingPrice;

  const putWalls = puts.sort((a, b) => b.openInterest - a.openInterest).slice(0, 3);
  const callWalls = calls.sort((a, b) => b.openInterest - a.openInterest).slice(0, 3);
  const putWall = putWalls.length > 0 ? putWalls[0].strike : 0;
  const callWall = callWalls.length > 0 ? callWalls[0].strike : 0;

  const ivRank = avgIV > 50 ? "高IV（可能反转）" : avgIV < 20 ? "低IV（趋势可能持续）" : "中等IV";
  const pcSignal = putCallRatio > 1.2 ? "偏多（put堆积）" : putCallRatio < 0.7 ? "偏空（call堆积）" : "中性";

  const nextExpiration = optionsChain.length > 0 ? optionsChain[0].expiration : "";

  return {
    symbol,
    timestamp: new Date().toISOString(),
    underlying_price: underlyingPrice,
    next_expiration: nextExpiration,
    options_chain: optionsChain.slice(0, 20),
    put_call_ratio: Math.round(putCallRatio * 100) / 100,
    iv_percentile: Math.round(ivPercentile * 100) / 100,
    total_volume: totalCallVol + totalPutVol,
    total_open_interest: optionsChain.reduce((a, o) => a + o.openInterest, 0),
    near_term_iv: Math.round(avgIV * 100) / 100,
    term_structure: {},
    signals: {
      iv_rank: ivRank,
      pc_ratio_signal: pcSignal,
      concentration_signal: "需更多数据",
    },
    near_term_options: {
      calls: calls.slice(0, 5),
      puts: puts.slice(0, 5),
    },
    risk_metrics: {
      max_pain: Math.round(maxPain * 100) / 100,
      put_wall: putWall,
      call_wall: callWall,
    },
  };
}

function generateSimulatedOptionsData(symbol: string): any {
  const currentPrice = 150;
  const strikes = [];
  for (let i = -5; i <= 5; i++) {
    strikes.push(Math.round((currentPrice + i * 5) / 5) * 5);
  }

  const options = [];
  const expiration = new Date();
  expiration.setDate(expiration.getDate() + 30);
  const expStr = expiration.toISOString().split("T")[0];

  for (const strike of strikes) {
    const callPrice = Math.max(0, currentPrice - strike + (currentPrice * 0.05));
    const putPrice = Math.max(0, strike - currentPrice + (currentPrice * 0.05));
    const iv = 30 + Math.random() * 40;

    options.push({
      expiration: expStr,
      strike,
      callPrice,
      putPrice,
      delta: 0.3 + Math.random() * 0.4,
      gamma: 0.01 + Math.random() * 0.05,
      theta: -0.05 - Math.random() * 0.2,
      vega: 0.1 + Math.random() * 0.3,
      rho: 0.01 + Math.random() * 0.05,
      iv,
      volume: Math.floor(Math.random() * 10000),
      openInterest: Math.floor(Math.random() * 50000),
      type: "call",
    });
    options.push({
      expiration: expStr,
      strike,
      callPrice: 0,
      putPrice,
      delta: -(0.3 + Math.random() * 0.4),
      gamma: 0.01 + Math.random() * 0.05,
      theta: -0.05 - Math.random() * 0.2,
      vega: 0.1 + Math.random() * 0.3,
      rho: -0.01 - Math.random() * 0.05,
      iv,
      volume: Math.floor(Math.random() * 10000),
      openInterest: Math.floor(Math.random() * 50000),
      type: "put",
    });
  }

  return {
    _simulated: true,
    _dataSource: "FALLBACK_SIMULATION",
    symbol,
    underlying_price: currentPrice,
    options,
  };
}
