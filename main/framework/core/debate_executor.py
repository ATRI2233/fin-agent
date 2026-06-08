"""Debate executor — multiple agents analyse, a judge picks the winner."""

from __future__ import annotations

import logging
from typing import Any

from main.framework.core.agent_dispatcher import AgentDispatcher

logger = logging.getLogger(__name__)


class DebateExecutor:
    """Execute debate blocks where multiple agents analyse the same prompt
    and a judge agent selects the winning analysis."""

    def __init__(self, dispatcher: AgentDispatcher):
        self._dispatcher = dispatcher

    async def execute_debate(self, debate_node: dict[str, Any]) -> dict[str, Any]:
        """Execute a debate block.

        Args:
            debate_node: {
                "type": "debate",
                "agents": [...],
                "judge": "judge_agent_id",
                "prompt": "analysis prompt"
            }

        Returns:
            {"winner": str, "analysis": dict, "reasoning": str}
        """
        agents = debate_node.get("agents", [])
        judge = debate_node.get("judge")
        prompt = debate_node.get("prompt", "")

        if not agents:
            raise ValueError("Debate requires at least one agent")

        # Run all agents in parallel
        raw_results = await self._dispatcher.dispatch_parallel(agents, prompt)

        # Normalise to the shape the judge expects
        agent_results = [
            {
                "agent": r["agent"],
                "analysis": r["result"],
                "error": r["error"],
            }
            for r in raw_results
        ]

        if judge:
            return await self._run_judge(judge, agent_results)
        return self._select_winner(agent_results)

    # ------------------------------------------------------------------
    # Judge
    # ------------------------------------------------------------------

    async def _run_judge(
        self, judge_agent: str, agent_results: list[dict[str, Any]]
    ) -> dict[str, Any]:
        logger.info(f"Running judge agent: {judge_agent}")
        judge_prompt = self._build_judge_prompt(agent_results)
        resp = await self._dispatcher.dispatch(judge_agent, judge_prompt, timeout=300)
        return self._parse_judge_result(resp["result"], agent_results)

    def _build_judge_prompt(self, agent_results: list[dict[str, Any]]) -> str:
        parts = ["请评估以下各代理的分析结果，选择最佳分析：\n"]

        for i, result in enumerate(agent_results, 1):
            name = result.get("agent", f"Agent{i}")
            analysis = result.get("analysis", {})
            error = result.get("error")

            parts.append(f"\n## 代理 {i}: {name}")
            if error:
                parts.append(f"错误: {error}")
            elif analysis:
                if isinstance(analysis, dict):
                    parts.append(f"分析结果:\n{self._format_dict(analysis)}")
                else:
                    parts.append(f"分析结果:\n{analysis}")
            else:
                parts.append("无有效分析结果")

        parts.append("\n\n请选择最佳分析并说明理由，输出格式：")
        parts.append(
            '{"winner": "代理名称", "analysis": {...}, "reasoning": "选择理由"}'
        )
        return "\n".join(parts)

    @staticmethod
    def _format_dict(d: dict[str, Any], indent: int = 0) -> str:
        lines: list[str] = []
        for k, v in d.items():
            if isinstance(v, dict):
                lines.append(f"  {k}:")
                lines.append(DebateExecutor._format_dict(v, indent + 1))
            else:
                lines.append(f"  {k}: {v}")
        return "\n".join(lines)

    @staticmethod
    def _parse_judge_result(
        raw: Any, agent_results: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if isinstance(raw, str):
            import json
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {"raw": raw}

        if not isinstance(raw, dict):
            raw = {"raw": raw}

        winner = raw.get("winner")
        analysis = raw.get("analysis")
        reasoning = raw.get("reasoning", "")

        # Validate winner
        if winner:
            for r in agent_results:
                if r.get("agent") == winner:
                    if analysis is None:
                        analysis = r.get("analysis")
                    break
            else:
                winner = None  # invalid winner name

        if not winner:
            for r in agent_results:
                if r.get("analysis") is not None:
                    winner = r.get("agent")
                    analysis = r.get("analysis")
                    reasoning = "自动选择（原始判断无效）"
                    break

        return {
            "winner": winner or "unknown",
            "analysis": analysis,
            "reasoning": reasoning,
        }

    @staticmethod
    def _select_winner(results: list[dict[str, Any]]) -> dict[str, Any]:
        valid = [r for r in results if r.get("analysis") is not None]
        if not valid:
            return {"winner": "none", "analysis": None, "reasoning": "无可用分析结果"}
        w = valid[0]
        return {
            "winner": w.get("agent"),
            "analysis": w.get("analysis"),
            "reasoning": f"自动选择 {w.get('agent')}（无 judge）",
        }
