"""Prompt template renderer for workflow nodes.

纯字符串模板替换,无 IO 无 DB。``build_prompt`` 是 sync 函数 —
后续若 ``RetryService`` 用 ``retry_on_failure`` 装饰器包它,装饰器
包装的就是 sync 调用链;不要写 ``await build_prompt(...)``。

支持的占位符语法:
    - ``{{params.x}}`` → ``params["x"]``
    - ``{{results.<pred_id>.output}}`` → ``results[pred_id]["output"]``
    - ``{{results.<pred_id>.<rest>}}`` → ``results[pred_id]["output"][<rest>]``

找不到对应值时保留原占位符文本(便于上游模板编辑器自检)。
"""

from __future__ import annotations

import re
from typing import Any, Mapping

# 匹配 {{...}} 占位符。内部路径禁止包含 "}"。
_PLACEHOLDER_RE = re.compile(r"\{\{([^}]+)\}\}")


def _resolve_placeholder(
    path: str,
    *,
    params: dict[str, Any],
    results: Mapping[str, dict[str, Any]],
) -> str:
    """解析单条占位符路径,失败时返回原始 ``{{path}}``。

    Args:
        path: 占位符内部路径,不含 ``{{`` / ``}}``。
        params: 触发参数。
        results: 前驱节点已完成结果,``NodeId`` -> ``NodeResult`` 字典。

    Returns:
        替换后的字符串值;无法解析则保留 ``{{path}}`` 原文本。
    """
    if path.startswith("params."):
        key = path[len("params."):]
        if key in params:
            value = params[key]
            return str(value)
        return "{{" + path + "}}"

    if path.startswith("results."):
        rest = path[len("results."):]
        pred_id, _, sub_key = rest.partition(".")
        if not pred_id or pred_id not in results:
            return "{{" + path + "}}"
        pred_result = results[pred_id]
        output = pred_result.get("output") if isinstance(pred_result, dict) else None
        if not sub_key:
            # 纯路径 {{results.<pred_id>}}:输出整个 output 值。
            return str(output) if output is not None else "{{" + path + "}}"
        if sub_key == "output":
            # {{results.<pred_id>.output}} -> 直接取 output(不再下钻)
            return str(output) if output is not None else "{{" + path + "}}"
        # {{results.<pred_id>.<rest>}}:在 output 字典上下钻
        if isinstance(output, Mapping) and sub_key in output:
            return str(output[sub_key])
        return "{{" + path + "}}"

    # 未识别前缀:保留原占位符
    return "{{" + path + "}}"


def build_prompt(
    template: str,
    *,
    node: Any,
    edges: list[Any],
    params: dict[str, Any],
    results: Mapping[str, dict[str, Any]],
    predecessor_ids: list[Any],
    node_id: Any,
) -> str:
    """渲染 prompt 模板字符串(sync,纯字符串处理)。

    扫描 ``template`` 中的 ``{{path}}`` 占位符并替换为实际值;无 IO、
    无 DB 调用,可放心在 sync / async 上下文中直接调用。

    Args:
        template: 模板字符串,可包含 ``{{params.x}}`` /
            ``{{results.<pred_id>.output}}`` 等占位符。
        node: 当前节点数据对象(渲染时未引用,保留供未来扩展)。
        edges: 与当前节点相关的边数据列表(渲染时未引用)。
        params: 触发参数,``dict[str, Any]``;宽泛类型,业务字段由
            ``ExecutionParams`` TypedDict(TASK-002 ``infra.domain``)定义。
        results: 前驱节点已完成结果,``NodeId`` -> ``NodeResult``。
        predecessor_ids: 前驱节点 ID 列表(渲染时未引用)。
        node_id: 当前节点 ID(渲染时未引用)。

    Returns:
        替换后的字符串。无法解析的占位符保留 ``{{path}}`` 原文本。
    """
    # 显式标注使用,避免 linter 误报(签名留给调用方契约对齐)
    _ = (node, edges, predecessor_ids, node_id)

    def _replace(match: re.Match[str]) -> str:
        path = match.group(1).strip()
        return _resolve_placeholder(path, params=params, results=results)

    return _PLACEHOLDER_RE.sub(_replace, template)


__all__ = ["build_prompt"]
