"""Stock name to code lookup tool."""

import json
from ..utils import http_get

# Common A-share stock name to code mapping
# This is a fallback; the primary method is API lookup
STOCK_NAME_MAP = {
    # 招商系
    "招商南油": "601975",
    "招商轮船": "601872",
    "招商银行": "600036",
    "招商蛇口": "001979",
    "招商证券": "600999",
    "招商公路": "001965",
    "招商港口": "001872",
    # 白酒
    "贵州茅台": "600519",
    "五粮液": "000858",
    "泸州老窖": "000568",
    "山西汾酒": "600809",
    "洋河股份": "002304",
    # 银行
    "工商银行": "601398",
    "建设银行": "601939",
    "农业银行": "601288",
    "中国银行": "601988",
    # 新能源
    "宁德时代": "300750",
    "比亚迪": "002594",
    "隆基绿能": "601012",
    "阳光电源": "300274",
    # 科技
    "海康威视": "002415",
    "立讯精密": "002475",
    "中芯国际": "688981",
    # 医药
    "恒瑞医药": "600276",
    "药明康德": "603259",
    "迈瑞医疗": "300760",
    # 消费
    "中国平安": "601318",
    "美的集团": "000333",
    "格力电器": "000651",
}

def _search_stock_name(name):
    """Search stock code by name using Sina Finance API."""
    try:
        # Suggest API: https://suggest3.sinajs.cn/suggest/type=&key=NAME&name=suggest
        url = f"https://suggest3.sinajs.cn/suggest/type=&key={name}&name=suggest"
        text = http_get(url, encoding="utf-8")
        if not text:
            return None

        # Parse response: suggest="...,code1,name1,code2,name2,..."
        parts = text.split('"')[1].split(",") if '"' in text else []
        results = []
        for i in range(0, len(parts) - 1, 2):
            code = parts[i]
            stock_name = parts[i + 1]
            # Filter for A-shares (6 digits)
            if code.isdigit() and len(code) == 6:
                results.append({"code": code, "name": stock_name})
        return results
    except Exception:
        return None


def stock_lookup(name):
    """Look up stock code by name.

    Args:
        name: Stock name (Chinese or English)

    Returns:
        dict with stock code and name, or error message
    """
    if not name:
        return {"error": "Missing stock name"}

    name = name.strip()

    # 1. Check if it's already a code
    if name.isdigit() and len(name) == 6:
        return {"code": name, "name": None, "source": "direct_code"}

    # 2. Check local mapping
    if name in STOCK_NAME_MAP:
        return {"code": STOCK_NAME_MAP[name], "name": name, "source": "local_map"}

    # 3. Search via API
    results = _search_stock_name(name)
    if results:
        # Return first match
        return {
            "code": results[0]["code"],
            "name": results[0]["name"],
            "source": "api_search",
            "all_matches": results[:5], # Return top 5 matches
        }

    return {"error": f"Stock not found: {name}"}


if __name__ == "__main__":
    # Test
    test_cases = ["招商南油", "招商轮船", "贵州茅台", "601975", "AAPL"]
    for case in test_cases:
        result = stock_lookup(case)
        print(f"{case}: {json.dumps(result, ensure_ascii=False)}")
