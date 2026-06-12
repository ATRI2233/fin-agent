# Technical analysis tools
from ..utils import is_ashare, normalize_symbol, get_market_code, is_etf, parse_ashare_code, http_get, get_daily_data
import math

def calculate_rsi(close, period=14):
    """计算 RSI"""
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_ema(series, period):
    """计算 EMA"""
    return series.ewm(span=period, adjust=False).mean()


def calculate_bollinger_bands(close, period=20, std_dev=2):
    """计算布林带"""
    sma = close.rolling(window=period).mean()
    std = close.rolling(window=period).std()
    upper = sma + (std * std_dev)
    lower = sma - (std * std_dev)
    return upper, sma, lower


def calculate_macd(close, fast=12, slow=26, signal=9):
    """计算 MACD"""
    ema_fast = calculate_ema(close, fast)
    ema_slow = calculate_ema(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = calculate_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calculate_pivot_points(high, low, close):
    """计算枢轴点"""
    pivot = (high + low + close) / 3
    r1 = 2 * pivot - low
    s1 = 2 * pivot - high
    r2 = pivot + (high - low)
    s2 = pivot - (high - low)
    r3 = high + 2 * (pivot - low)
    s3 = low - 2 * (high - pivot)
    return {
        "R1": round(r1, 2),
        "R2": round(r2, 2),
        "R3": round(r3, 2),
        "Pivot": round(pivot, 2),
        "S1": round(s1, 2),
        "S2": round(s2, 2),
        "S3": round(s3, 2),
    }


def get_technical_levels(symbol):
    """获取技术指标"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        data = get_daily_data(symbol)
        if "error" in data:
            return data

        klines = data.get("klines", [])
        if not klines or not isinstance(klines, list):
            return {"error": "K线数据为空或格式错误"}

        closes = []
        highs = []
        lows = []
        vols = []

        for k in klines[-250:]:
            closes.append(float(k["close"]))
            highs.append(float(k["high"]))
            lows.append(float(k["low"]))
            vols.append(int(k.get("volume", 0)))

        close = np.array(closes)
        high = np.array(highs)
        low = np.array(lows)

        def calc_rsi(arr, period=14):
            delta = np.diff(arr)
            gain = np.where(delta > 0, delta, 0)
            loss = np.where(delta < 0, -delta, 0)
            avg_gain = np.convolve(gain, np.ones(period) / period, mode="valid")
            avg_loss = np.convolve(loss, np.ones(period) / period, mode="valid")
            rs = avg_gain / (avg_loss + 1e-10)
            return 100 - (100 / (1 + rs))

        def calc_ema(arr, period):
            alpha = 2.0 / (period + 1)
            ema = [arr[0]]
            for v in arr[1:]:
                ema.append(alpha * v + (1 - alpha) * ema[-1])
            return np.array(ema)

        def calc_bb(arr, period=20, std_dev=2):
            sma = np.convolve(arr, np.ones(period) / period, mode="valid")
            std = np.array([np.std(arr[i : i + period]) for i in range(len(arr) - period + 1)])
            upper = sma + std_dev * std
            lower = sma - std_dev * std
            return upper, sma, lower

        def calc_macd(arr, fast=12, slow=26, signal=9):
            ema_fast = calc_ema(arr, fast)
            ema_slow = calc_ema(arr, slow)
            macd_line = ema_fast - ema_slow
            signal_line = calc_ema(macd_line, signal)
            histogram = macd_line - signal_line
            return macd_line, signal_line, histogram

        rsi_14 = calc_rsi(close, 14)
        rsi_28 = calc_rsi(close, 28)

        ema_5 = calc_ema(close, 5)
        ema_10 = calc_ema(close, 10)
        ema_20 = calc_ema(close, 20)
        ema_60 = calc_ema(close, 60)
        ema_120 = calc_ema(close, 120) if len(close) >= 120 else None
        ema_250 = calc_ema(close, 250) if len(close) >= 250 else None

        bb_upper, bb_middle, bb_lower = calc_bb(close)
        macd_line, macd_signal, macd_hist = calc_macd(close)

        latest_close = close[-1]
        latest_high = high[-1]
        latest_low = low[-1]
        pivot = (latest_high + latest_low + latest_close) / 3
        r1 = 2 * pivot - latest_low
        s1 = 2 * pivot - latest_high
        r2 = pivot + (latest_high - latest_low)
        s2 = pivot - (latest_high - latest_low)
        r3 = latest_high + 2 * (pivot - latest_low)
        s3 = latest_low - 2 * (latest_high - pivot)

        log_ret = np.log(close[1:] / close[:-1])
        vol_20d = np.std(log_ret[-20:]) * np.sqrt(252) if len(log_ret) >= 20 else 0

        return {
            "symbol": symbol,
            "current_price": round(latest_close, 2),
            "rsi": {
                "rsi_14": round(float(rsi_14[-1]), 2),
                "rsi_28": round(float(rsi_28[-1]), 2),
            },
            "ema": {
                "ema_5": round(float(ema_5[-1]), 2),
                "ema_10": round(float(ema_10[-1]), 2),
                "ema_20": round(float(ema_20[-1]), 2),
                "ema_60": round(float(ema_60[-1]), 2),
                "ema_120": round(float(ema_120[-1]), 2) if ema_120 is not None and len(ema_120) > 0 else None,
                "ema_250": round(float(ema_250[-1]), 2) if ema_250 is not None and len(ema_250) > 0 else None,
            },
            "bollinger_bands": {
                "upper": round(float(bb_upper[-1]), 2),
                "middle": round(float(bb_middle[-1]), 2),
                "lower": round(float(bb_lower[-1]), 2),
            },
            "macd": {
                "macd": round(float(macd_line[-1]), 4),
                "signal": round(float(macd_signal[-1]), 4),
                "histogram": round(float(macd_hist[-1]), 4),
            },
            "pivot_points": {
                "R1": round(r1, 2),
                "R2": round(r2, 2),
                "R3": round(r3, 2),
                "Pivot": round(pivot, 2),
                "S1": round(s1, 2),
                "S2": round(s2, 2),
                "S3": round(s3, 2),
            },
            "volatility_20d_annualized_pct": round(float(vol_20d) * 100, 2),
        }
    except Exception as e:
        return {"error": f"技术指标计算失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 3: ashare_fundamental_scan — 基本面
# ═══════════════════════════════════════════════════
