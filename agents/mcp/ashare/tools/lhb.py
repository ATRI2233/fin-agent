# LHB (Dragon Tiger List) tools
from ..utils import is_ashare, normalize_symbol, get_market_code, is_etf, parse_ashare_code, http_get, get_daily_data

def get_lhb(date=None):
    """获取龙虎榜数据（指定日期或最新）"""
    if not HAS_DEPS:
        return {"error": "akshare 未安装"}

    try:
        if date:
            df = ak.stock_lhb_detail_em(start_date=date, end_date=date)
        else:
            end_date = datetime.now().strftime("%Y%m%d")
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
            df = ak.stock_lhb_detail_em(start_date=start_date, end_date=end_date)

        if df is None or df.empty:
            return {"error": "无法获取龙虎榜数据"}

        records = []
        for _, row in df.head(20).iterrows():
            close_val = row.get("收盘价")
            change_val = row.get("涨跌幅")
            buy_val = row.get("龙虎榜买入金额")
            sell_val = row.get("龙虎榜卖出金额")
            records.append(
                {
                    "date": str(row.get("发布日期", ""))[:10] if row.get("发布日期") else None,
                    "code": str(row.get("代码", "")),
                    "name": str(row.get("名称", "")),
                    "close": float(close_val) if close_val is not None else 0,
                    "change_pct": float(change_val) if change_val is not None else 0,
                    "reason": str(row.get("上榜原因", "")),
                    "buy_amount": float(buy_val) if buy_val is not None else 0,
                    "sell_amount": float(sell_val) if sell_val is not None else 0,
                }
            )

        return {"records": records, "count": len(records)}
    except Exception as e:
        return {"error": f"龙虎榜获取失败: {str(e)}"}


# ═══════════════════════════════════════════════════
# Tool 8: ashare_sector_rotation — 板块轮动分析
# ═══════════════════════════════════════════════════
