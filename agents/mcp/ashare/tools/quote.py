# Quote tool
from ..utils import is_ashare, normalize_symbol, get_market_code, http_get

def get_quote(symbol):
    """获取 A 股实时行情"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    market = get_market_code(normalize_symbol(symbol))
    if not market:
        return {"error": f"无法识别市场: {symbol}"}

    code = symbol if symbol.startswith(("6", "0", "3")) else symbol[:6]
    url = f"https://hq.sinajs.cn/list={market}{code}"

    text = http_get(url)
    if not text:
        return {"error": "无法获取行情数据（可能网络问题或接口被屏蔽）"}

    try:
        parts = text.strip().split("=")
        if len(parts) < 2:
            return {"error": "行情数据解析失败"}

        data_str = parts[1].strip().strip('";').strip()
        if not data_str or data_str == "failed":
            return {"error": "行情数据为空或无效"}

        fields = data_str.split(",")
        if len(fields) < 10:
            return {"error": f"行情字段不足: {len(fields)}"}

        name = fields[0]
        open_price = float(fields[1]) if fields[1] else 0
        close_price = float(fields[2]) if fields[2] else 0
        current_price = float(fields[3]) if fields[3] else close_price
        high_price = float(fields[4]) if fields[4] else 0
        low_price = float(fields[5]) if fields[5] else 0
        volume = int(fields[8]) if fields[8] else 0
        amount = float(fields[9]) if fields[9] else 0

        change = current_price - close_price
        change_pct = (change / close_price * 100) if close_price > 0 else 0

        return {
            "symbol": symbol,
            "name": name,
            "current_price": round(current_price, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "open": round(open_price, 2),
            "high": round(high_price, 2),
            "low": round(low_price, 2),
            "close": round(close_price, 2),
            "volume": volume,
            "amount": round(amount, 2),
            "market": market.upper(),
        }
    except Exception as e:
        return {"error": f"解析失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 2: ashare_technical_levels — 技术指标
# ═══════════════════════════════════════════════════


