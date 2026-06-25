# Fundamental analysis tools
from ..utils import is_ashare, is_etf, parse_ashare_code, http_get, retry_akshare
import logging

try:
    import akshare as ak
    import pandas as pd

    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False

logger = logging.getLogger(__name__)

def get_fundamental_scan(symbol):
    """获取基本面数据"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    if is_etf(symbol):
        return {
            "error": f"{symbol} 是 ETF 基金，无传统基本面数据（PE/PB/ROE 不适用）",
            "symbol": symbol,
        }

    try:
        market, code = parse_ashare_code(symbol)
        if not market:
            return {"error": f"无法识别的代码: {symbol}"}

        url = f"https://qt.gtimg.cn/q={market}{code}"
        text = http_get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://finance.qq.com/",
            },
            encoding="gbk",
        )
        if not text:
            return {"error": "无法获取基本面数据（网络问题）"}

        parts = text.split("~")
        if len(parts) < 55:
            return {"error": f"数据字段不足: {len(parts)}"}

        def safe_float(v):
            try:
                return float(v) if v and v.strip() and v != "-" else None
            except Exception as e:
                logger.debug("safe_float parsing error: %s", e, exc_info=True)
                return None

        base_result = {
            "symbol": symbol,
            "name": parts[1] if len(parts) > 1 else "",
            "pe_ttm": safe_float(parts[52]) if len(parts) > 52 else None,
            "pb": safe_float(parts[46]) if len(parts) > 46 else None,
            "roe": safe_float(parts[49]) if len(parts) > 49 else None,
            "market_cap_total": safe_float(parts[44]) if len(parts) > 44 else None,
        }

        # ── 使用 AKShare 补充财务数据 ──
        extra = {}
        if HAS_DEPS:
            try:
                # 个股信息（含 EPS、每股净资产、总市值、流通市值等）
                df_info = retry_akshare(ak.stock_individual_info_em, symbol=code)
                if df_info is not None and not df_info.empty:
                    info_dict = {}
                    for _, row in df_info.iterrows():
                        key = str(row.iloc[0]).strip() if len(row) > 0 else ""
                        val = row.iloc[1] if len(row) > 1 else None
                        info_dict[key] = val

                    def safe_info_float(d, *keys):
                        for k in keys:
                            if k in d and d[k] is not None:
                                try:
                                    return float(d[k])
                                except (ValueError, TypeError):
                                    continue
                        return None

                    extra["eps"] = safe_info_float(info_dict, "每股收益", "每股收益(元)")
                    extra["bvps"] = safe_info_float(info_dict, "每股净资产", "每股净资产(元)")
                    extra["total_shares"] = safe_info_float(info_dict, "总股本", "总股本(股)")
                    extra["float_shares"] = safe_info_float(info_dict, "流通股", "流通股(股)")
            except Exception as e:
                logger.debug("stock_individual_info_em failed: %s", e)

            try:
                # 财务摘要（含营收、净利润、毛利率等）
                df_fin = retry_akshare(ak.stock_financial_abstract_ths, symbol=code, indicator="按年度")
                if df_fin is not None and not df_fin.empty:
                    latest = df_fin.iloc[0]
                    cols = df_fin.columns.tolist()

                    def find_col(*names):
                        for n in names:
                            for c in cols:
                                if n in c:
                                    return c
                        return None

                    rev_col = find_col("营业总收入", "营业收入")
                    ni_col = find_col("净利润", "归母净利润")
                    gm_col = find_col("毛利率", "销售毛利率")
                    om_col = find_col("营业利润率", "营业利润")
                    debt_col = find_col("资产负债率")
                    cur_col = find_col("流动比率")
                    eps_col = find_col("基本每股收益", "每股收益")

                    def safe_series_float(col_name):
                        if col_name and col_name in cols:
                            val = latest.get(col_name)
                            if val is not None:
                                try:
                                    return float(val)
                                except (ValueError, TypeError):
                                    pass
                        return None

                    rev = safe_series_float(rev_col)
                    ni = safe_series_float(ni_col)
                    gm = safe_series_float(gm_col)
                    om = safe_series_float(om_col)
                    dr = safe_series_float(debt_col)
                    cr = safe_series_float(cur_col)
                    eps_from_fin = safe_series_float(eps_col)

                    if rev is not None:
                        extra["revenue"] = rev
                    if ni is not None:
                        extra["net_income"] = ni
                    if gm is not None:
                        extra["gross_margin_pct"] = gm
                    if om is not None:
                        extra["operating_margin_pct"] = om
                    if dr is not None:
                        extra["debt_ratio_pct"] = dr
                    if cr is not None:
                        extra["current_ratio"] = cr
                    if eps_from_fin is not None and "eps" not in extra:
                        extra["eps"] = eps_from_fin

                    # YoY growth
                    if len(df_fin) >= 2:
                        prev = df_fin.iloc[1]
                        if rev_col and rev is not None:
                            try:
                                prev_rev = float(prev.get(rev_col, 0))
                                if prev_rev and prev_rev != 0:
                                    extra["revenue_yoy_pct"] = round((rev - prev_rev) / abs(prev_rev) * 100, 2)
                            except (ValueError, TypeError):
                                pass
                        if ni_col and ni is not None:
                            try:
                                prev_ni = float(prev.get(ni_col, 0))
                                if prev_ni and prev_ni != 0:
                                    extra["net_income_yoy_pct"] = round((ni - prev_ni) / abs(prev_ni) * 100, 2)
                            except (ValueError, TypeError):
                                pass
            except Exception as e:
                logger.debug("stock_financial_abstract_ths failed: %s", e)

            try:
                # 股息率
                df_div = retry_akshare(ak.stock_fhps_em, symbol=code)
                if df_div is not None and not df_div.empty:
                    for _, row in df_div.head(3).iterrows():
                        div_cols = df_div.columns.tolist()
                        div_col = None
                        for c in div_cols:
                            if "股息" in c or "每股派" in c:
                                div_col = c
                                break
                        if div_col:
                            div_val = row.get(div_col)
                            if div_val is not None:
                                try:
                                    dv = float(div_val)
                                    if dv > 0:
                                        extra["dividend_per_share"] = dv
                                        # 计算股息率
                                        cur_price = safe_float(parts[3]) if len(parts) > 3 else None
                                        if cur_price and cur_price > 0:
                                            extra["dividend_yield_pct"] = round(dv / cur_price * 100, 2)
                                        break
                                except (ValueError, TypeError):
                                    continue
            except Exception as e:
                logger.debug("stock_fhps_em failed: %s", e)

        # 标记未能获取的字段为 N/A
        for field in [
            "revenue",
            "net_income",
            "eps",
            "dividend_yield_pct",
            "debt_ratio_pct",
            "current_ratio",
            "gross_margin_pct",
            "operating_margin_pct",
            "revenue_yoy_pct",
            "net_income_yoy_pct",
        ]:
            if field not in extra:
                extra[field] = "N/A"

        base_result.update(extra)
        return base_result

    except Exception as e:
        return {"error": f"基本面获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 4: ashare_news_sentiment — 新闻与情绪
# ═══════════════════════════════════════════════════
