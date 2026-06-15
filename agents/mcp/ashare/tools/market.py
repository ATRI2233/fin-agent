# Market tools
from ..utils import is_ashare, normalize_symbol, get_market_code, is_etf, parse_ashare_code, http_get, get_daily_data, retry_akshare
from datetime import datetime

try:
    import akshare as ak

    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False

INDEX_CODES = {
    "上证指数": "000001",
    "深证成指": "399001",
    "创业板指": "399006",
    "沪深300": "000300",
    "科创50": "000688",
    "上证50": "000016",
    "中证500": "000905",
    "中证1000": "000852",
}

def get_market_snapshot():
    """获取 A 股主要大盘指数行情"""
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        indices = []
        for name, code in INDEX_CODES.items():
            try:
                market = "sz" if code.startswith("0") else "sh"
                url = f"https://hq.sinajs.cn/list={market}{code}"
                text = http_get(url)
                if text and "failed" not in text:
                    parts = text.strip().split("=")
                    if len(parts) >= 2:
                        data_str = parts[1].strip().strip('";').strip()
                        fields = data_str.split(",")
                        if len(fields) >= 10:
                            current = float(fields[3]) if fields[3] else 0
                            close = float(fields[2]) if fields[2] else 0
                            change = current - close
                            change_pct = (change / close * 100) if close > 0 else 0
                            indices.append(
                                {
                                    "name": name,
                                    "code": code,
                                    "current": round(current, 2),
                                    "change": round(change, 2),
                                    "change_pct": round(change_pct, 2),
                                }
                            )
            except Exception:
                continue

        if not indices:
            return {"error": "无法获取大盘指数数据"}

        return {"indices": indices, "count": len(indices)}
    except Exception as e:
        return {"error": f"大盘指数获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 6: ashare_fund_flow — 资金流向
# ═══════════════════════════════════════════════════

def get_sector_rotation(period="近5日"):
    """获取 A 股板块轮动分析（行业板块涨跌幅排名 + 轮动信号）

    Args:
        period: 分析周期，可选 "近1日"/"近5日"/"近10日"/"近20日"
    """
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        # 获取行业板块列表
        df_industries = retry_akshare(ak.stock_board_industry_name_em)
        if df_industries is None or df_industries.empty:
            return {"error": "无法获取行业板块列表"}

        cols = df_industries.columns.tolist()
        name_col = None
        for c in cols:
            if "板块名称" in c or "名称" in c:
                name_col = c
                break
        if not name_col:
            name_col = cols[0]

        # 收集各板块近期涨跌幅
        sector_data = []
        for _, row in df_industries.head(30).iterrows():
            sector_name = str(row[name_col])
            try:
                df_hist = retry_akshare(
                    ak.stock_board_industry_hist_em,
                    symbol=sector_name,
                    period="日k",
                    start_date="20200101",
                    end_date="20991231",
                )
                if df_hist is None or df_hist.empty:
                    continue

                hcols = df_hist.columns.tolist()
                pct_col = None
                for c in hcols:
                    if "涨跌幅" in c or "涨幅" in c:
                        pct_col = c
                        break
                if not pct_col:
                    continue

                # 计算不同周期涨跌幅
                pcts = df_hist[pct_col].dropna()
                if len(pcts) < 1:
                    continue

                pct_1d = float(pcts.iloc[-1])
                pct_5d = float(pcts.tail(5).sum()) if len(pcts) >= 5 else pct_1d
                pct_10d = float(pcts.tail(10).sum()) if len(pcts) >= 10 else pct_5d
                pct_20d = float(pcts.tail(20).sum()) if len(pcts) >= 20 else pct_10d

                # 动量信号：近期加速 vs 减速
                recent_5 = float(pcts.tail(5).sum()) if len(pcts) >= 5 else 0
                prev_5 = float(pcts.iloc[-10:-5].sum()) if len(pcts) >= 10 else 0
                momentum = recent_5 - prev_5

                sector_data.append(
                    {
                        "name": sector_name,
                        "pct_1d": round(pct_1d, 2),
                        "pct_5d": round(pct_5d, 2),
                        "pct_10d": round(pct_10d, 2),
                        "pct_20d": round(pct_20d, 2),
                        "momentum": round(momentum, 2),
                    }
                )
            except Exception:
                continue

        if not sector_data:
            return {"error": "无法获取板块数据"}

        # 按指定周期排序
        period_key = {
            "近1日": "pct_1d",
            "近5日": "pct_5d",
            "近10日": "pct_10d",
            "近20日": "pct_20d",
        }.get(period, "pct_5d")

        sector_data.sort(key=lambda x: x[period_key], reverse=True)

        top_sectors = sector_data[:5]
        bottom_sectors = sector_data[-5:]

        # 轮动信号：按动量排序
        sector_data.sort(key=lambda x: x["momentum"], reverse=True)
        gaining_momentum = [s for s in sector_data[:5]]
        losing_momentum = [s for s in sector_data[-5:]]

        return {
            "period": period,
            "top_sectors": top_sectors,
            "bottom_sectors": bottom_sectors,
            "rotation_signal": {
                "gaining_momentum": gaining_momentum,
                "losing_momentum": losing_momentum,
            },
            "total_sectors_analyzed": len(sector_data),
        }
    except Exception as e:
        return {"error": f"板块轮动分析失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 9: ashare_fund_flow_real — 实时资金流向
# ═══════════════════════════════════════════════════

def get_market_breadth():
    """获取 A 股市场广度：涨跌家数、涨停跌停、市场情绪

    使用 AKShare:
    - stock_market_activity_legu: 涨跌家数
    - stock_zt_pool_em: 涨停池
    - stock_dt_pool_em: 跌停池
    """
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        today = datetime.now().strftime("%Y%m%d")

        # 涨跌家数
        advance_count = 0
        decline_count = 0
        flat_count = 0
        try:
            df_activity = ak.stock_market_activity_legu()
            if df_activity is not None and not df_activity.empty:
                acols = df_activity.columns.tolist()
                for c in acols:
                    if "上涨" in c and "家" in c:
                        vals = df_activity[c].dropna()
                        if len(vals) > 0:
                            advance_count = int(float(vals.iloc[-1]))
                    elif "下跌" in c and "家" in c:
                        vals = df_activity[c].dropna()
                        if len(vals) > 0:
                            decline_count = int(float(vals.iloc[-1]))
                    elif "平盘" in c:
                        vals = df_activity[c].dropna()
                        if len(vals) > 0:
                            flat_count = int(float(vals.iloc[-1]))
        except Exception:
            pass

        # 涨停家数
        limit_up_count = 0
        limit_up_list = []
        try:
            df_zt = retry_akshare(ak.stock_zt_pool_em, date=today)
            if df_zt is not None and not df_zt.empty:
                limit_up_count = len(df_zt)
                zcols = df_zt.columns.tolist()
                name_col = "名称" if "名称" in zcols else (zcols[1] if len(zcols) > 1 else zcols[0])
                code_col = "代码" if "代码" in zcols else (zcols[0] if len(zcols) > 0 else None)
                for _, row in df_zt.head(10).iterrows():
                    item = {"name": str(row.get(name_col, ""))}
                    if code_col:
                        item["code"] = str(row.get(code_col, ""))
                    limit_up_list.append(item)
        except Exception:
            pass

        # 跌停家数
        limit_down_count = 0
        limit_down_list = []
        try:
            df_dt = retry_akshare(ak.stock_dt_pool_em, date=today)
            if df_dt is not None and not df_dt.empty:
                limit_down_count = len(df_dt)
                dcols = df_dt.columns.tolist()
                name_col = "名称" if "名称" in dcols else (dcols[1] if len(dcols) > 1 else dcols[0])
                code_col = "代码" if "代码" in dcols else (dcols[0] if len(dcols) > 0 else None)
                for _, row in df_dt.head(10).iterrows():
                    item = {"name": str(row.get(name_col, ""))}
                    if code_col:
                        item["code"] = str(row.get(code_col, ""))
                    limit_down_list.append(item)
        except Exception:
            pass

        # 计算指标
        total = advance_count + decline_count + flat_count
        ad_ratio = round(advance_count / decline_count, 2) if decline_count > 0 else None

        # 市场情绪判定
        if ad_ratio is not None:
            if ad_ratio > 2:
                sentiment = "强势"
            elif ad_ratio > 1.2:
                sentiment = "偏多"
            elif ad_ratio > 0.8:
                sentiment = "中性"
            elif ad_ratio > 0.5:
                sentiment = "偏空"
            else:
                sentiment = "弱势"
        else:
            sentiment = "未知"

        return {
            "advance_count": advance_count,
            "decline_count": decline_count,
            "flat_count": flat_count,
            "total": total,
            "advance_decline_ratio": ad_ratio,
            "limit_up_count": limit_up_count,
            "limit_up_list": limit_up_list,
            "limit_down_count": limit_down_count,
            "limit_down_list": limit_down_list,
            "market_sentiment": sentiment,
            "date": today,
        }
    except Exception as e:
        return {"error": f"市场广度获取失败: {str(e)}"}
