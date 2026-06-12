# News sentiment tools
from ..utils import is_ashare, normalize_symbol, get_market_code, is_etf, parse_ashare_code, http_get, get_daily_data

def _calc_sentiment_score(text):
    """基于关键词匹配计算情绪评分 (0-100)，50 为中性"""
    pos_keywords = [
        "涨",
        "增长",
        "突破",
        "利好",
        "盈利",
        "超预期",
        "买入",
        "增持",
        "提升",
        "分红",
        "送股",
        "大涨",
        "涨停",
        "创新高",
        "强势",
        "回暖",
        "复苏",
        "翻倍",
    ]
    neg_keywords = [
        "跌",
        "下降",
        "风险",
        "利空",
        "亏损",
        "不及预期",
        "减持",
        "下调",
        "警告",
        "处罚",
        "大跌",
        "跌停",
        "爆雷",
        "退市",
        "违规",
        "暴跌",
        "崩盘",
        "清仓",
    ]
    pos_count = sum(1 for kw in pos_keywords if kw in text)
    neg_count = sum(1 for kw in neg_keywords if kw in text)
    total = pos_count + neg_count
    if total == 0:
        return 50
    return min(100, max(0, 50 + (pos_count - neg_count) * 10))


def get_news_sentiment(symbol):
    """获取个股新闻及情绪评分（含市场整体情绪加权）"""
    if not is_ashare(symbol):
        return {"error": f"{symbol} 不是 A 股代码"}

    try:
        stock_code = symbol[:6]

        # ── 个股新闻: ak.stock_news_em ──
        try:
            df_news = ak.stock_news_em(symbol=stock_code)
        except Exception:
            df_news = pd.DataFrame()

        news_list = []
        if not df_news.empty:
            cols = df_news.columns.tolist()
            title_col = "新闻标题" if "新闻标题" in cols else cols[1] if len(cols) > 1 else cols[0]
            time_col = "发布时间" if "发布时间" in cols else cols[2] if len(cols) > 2 else None
            source_col = "文章来源" if "文章来源" in cols else cols[3] if len(cols) > 3 else None
            content_col = "新闻内容" if "新闻内容" in cols else cols[4] if len(cols) > 4 else None

            for _, row in df_news.head(20).iterrows():
                item = {
                    "title": str(row.get(title_col, "")),
                    "datetime": str(row[time_col])[:19] if time_col and pd.notna(row.get(time_col)) else None,
                    "source": str(row[source_col]) if source_col and pd.notna(row.get(source_col)) else None,
                }
                if content_col and pd.notna(row.get(content_col)):
                    item["summary"] = str(row[content_col])[:200]
                news_list.append(item)

        # ── 个股情绪 ──
        stock_title_text = " ".join([n["title"] for n in news_list])
        stock_sentiment = _calc_sentiment_score(stock_title_text)

        # ── 市场全局新闻: ak.stock_info_global_em ──
        market_sentiment = 50
        market_news_count = 0
        try:
            df_global = ak.stock_info_global_em()
            if not df_global.empty:
                gcols = df_global.columns.tolist()
                g_title_col = "标题" if "标题" in gcols else gcols[1] if len(gcols) > 1 else gcols[0]
                g_summary_col = "摘要" if "摘要" in gcols else gcols[2] if len(gcols) > 2 else None
                g_time_col = "发布时间" if "发布时间" in gcols else gcols[3] if len(gcols) > 3 else None

                market_headlines = []
                for _, row in df_global.head(30).iterrows():
                    headline = str(row.get(g_title_col, ""))
                    if g_summary_col and pd.notna(row.get(g_summary_col)):
                        headline += " " + str(row[g_summary_col])[:100]
                    market_headlines.append(headline)

                market_news_count = len(market_headlines)
                market_text = " ".join(market_headlines)
                market_sentiment = _calc_sentiment_score(market_text)
        except Exception as e:
            logger.debug(f"市场全局新闻获取失败: {e}")

        # ── 加权情绪 ──
        final_sentiment = round(0.7 * stock_sentiment + 0.3 * market_sentiment, 1)

        return {
            "symbol": symbol,
            "news_count": len(news_list),
            "news": news_list,
            "stock_sentiment": stock_sentiment,
            "market_sentiment": market_sentiment,
            "market_news_count": market_news_count,
            "sentiment_score": final_sentiment,
            "sentiment_label": "正面" if final_sentiment > 60 else "负面" if final_sentiment < 40 else "中性",
        }
    except Exception as e:
        return {"error": f"新闻获取失败: {str(e)}", "symbol": symbol}


# ═══════════════════════════════════════════════════
# Tool 5: ashare_market_snapshot — A 股大盘指数
# ═══════════════════════════════════════════════════

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
