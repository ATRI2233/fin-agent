"""opencode 输出解析器:剥离 thinking 块,提取文本 parts。"""

import re

_THINKING_RE = re.compile(r"<thinking>.*?</thinking>", re.DOTALL)


def strip_thinking(text: str) -> str:
    """去除文本中的 ``<thinking>...</thinking>`` 块(包括 multiline)。

    Args:
        text: 原始文本。

    Returns:
        剥离 thinking 块后并 strip 的文本。
    """
    return _THINKING_RE.sub("", text).strip()


def extract_text(data: dict) -> str:
    """从 opencode API 响应中提取 ``type == "text"`` 的 part 文本。

    Args:
        data: opencode 响应 dict,含 ``parts`` 字段。

    Returns:
        拼接后的文本;若 ``parts`` 缺失或为空则返回空串。
    """
    text_parts: list[str] = []
    for part in data.get("parts", []):
        if part.get("type") == "text":
            text_parts.append(part.get("text", ""))
    return "".join(text_parts)