import asyncio
import logging
from typing import List, Dict, Any, Optional

from main.framework.config import Settings
from main.framework.core.hapi_bridge import HAPIBridge

settings = Settings()
logger = logging.getLogger(__name__)


class DebateExecutor:
    """Execute debate blocks where multiple agents analyze the same prompt
    and a judge agent selects the winning analysis."""

    def __init__(self, hapi: Optional[HAPIBridge] = None):
        self.hapi = hapi or HAPIBridge(settings.HAPI_HUB_URL)

    async def execute_debate(self, debate_node: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a debate block.

        Args:
            debate_node: {
                "type": "debate",
                "agents": [...],  # list of agent names
                "judge": "judge_agent_id",
                "prompt": "analysis prompt for all agents"
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
        agent_results = await self.run_agents(agents, prompt)

        # Run judge to select winner
        if judge:
            winner_result = await self.run_judge(judge, agent_results)
            return winner_result
        else:
            # No judge, select winner by default logic
            return self.select_winner(agent_results)

    async def run_agents(self, agents: List[str], prompt: str) -> List[Dict[str, Any]]:
        """Run multiple agents in parallel.

        Args:
            agents: List of agent names to run
            prompt: The prompt to send to each agent

        Returns:
            List of agent results with "agent" and "analysis" keys
        """
        logger.info(f"Running {len(agents)} agents in parallel: {agents}")

        tasks = [self._run_single_agent(agent, prompt) for agent in agents]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results, converting exceptions to error dicts
        processed = []
        for agent, result in zip(agents, results):
            if isinstance(result, Exception):
                logger.error(f"Agent {agent} failed: {result}")
                processed.append(
                    {"agent": agent, "analysis": None, "error": str(result)}
                )
            else:
                processed.append({"agent": agent, "analysis": result, "error": None})

        return processed

    async def _run_single_agent(self, agent: str, prompt: str) -> Any:
        """Run a single agent via HAPI bridge."""
        session_id = await self.hapi.create_session()
        try:
            await self.hapi.send_message(session_id, prompt)
            raw = await self.hapi.wait_for_completion(session_id, timeout=300)
            return self._parse_result(raw)
        finally:
            await self.hapi.abort_session(session_id)

    def _parse_result(self, raw: str) -> Any:
        """Parse agent response into structured result."""
        import json

        try:
            return json.loads(raw)
        except Exception:
            return {"raw": raw, "parsed": False}

    async def run_judge(
        self, judge_agent: str, agent_results: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Run judge agent to select the winning analysis.

        Args:
            judge_agent: The judge agent name
            agent_results: List of agent results to evaluate

        Returns:
            {"winner": str, "analysis": dict, "reasoning": str}
        """
        logger.info(f"Running judge agent: {judge_agent}")

        # Build prompt for judge with all agent outputs
        judge_prompt = self._build_judge_prompt(agent_results)

        session_id = await self.hapi.create_session()
        try:
            await self.hapi.send_message(session_id, judge_prompt)
            raw = await self.hapi.wait_for_completion(session_id, timeout=300)
            return self._parse_judge_result(raw, agent_results)
        finally:
            await self.hapi.abort_session(session_id)

    def _build_judge_prompt(self, agent_results: List[Dict[str, Any]]) -> str:
        """Build prompt for judge agent with all agent results."""
        prompt_parts = ["请评估以下各代理的分析结果，选择最佳分析：\n"]

        for i, result in enumerate(agent_results, 1):
            agent_name = result.get("agent", f"Agent{i}")
            analysis = result.get("analysis", {})
            error = result.get("error")

            prompt_parts.append(f"\n## 代理 {i}: {agent_name}")

            if error:
                prompt_parts.append(f"错误: {error}")
            elif analysis:
                if isinstance(analysis, dict):
                    prompt_parts.append(f"分析结果:\n{self._format_dict(analysis)}")
                else:
                    prompt_parts.append(f"分析结果:\n{analysis}")
            else:
                prompt_parts.append("无有效分析结果")

        prompt_parts.append("\n\n请选择最佳分析并说明理由，输出格式：")
        prompt_parts.append(
            '{"winner": "代理名称", "analysis": {...}, "reasoning": "选择理由"}'
        )

        return "\n".join(prompt_parts)

    def _format_dict(self, d: Dict[str, Any], indent: int = 0) -> str:
        """Format dict for display in prompt."""
        lines = []
        for k, v in d.items():
            if isinstance(v, dict):
                lines.append(f"  {k}:")
                lines.append(self._format_dict(v, indent + 1))
            elif isinstance(v, list):
                lines.append(f"  {k}: {v}")
            else:
                lines.append(f"  {k}: {v}")
        return "\n".join(lines)

    def _parse_judge_result(
        self, raw: str, agent_results: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Parse judge result and map to agent results."""
        import json

        try:
            judge_output = json.loads(raw)
        except Exception:
            judge_output = {"raw": raw}

        winner = judge_output.get("winner")
        analysis = judge_output.get("analysis")
        reasoning = judge_output.get("reasoning", "")

        # Validate winner exists in agent results
        winner_valid = False
        if winner:
            for result in agent_results:
                if result.get("agent") == winner:
                    winner_valid = True
                    if analysis is None:
                        analysis = result.get("analysis")
                    break

        if not winner_valid:
            # Fallback to first valid result
            for result in agent_results:
                if result.get("analysis") is not None:
                    winner = result.get("agent")
                    analysis = result.get("analysis")
                    reasoning = "自动选择（原始判断无效）"
                    break

        return {
            "winner": winner or "unknown",
            "analysis": analysis,
            "reasoning": reasoning,
        }

    def select_winner(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Select winning analysis from results without judge.

        Args:
            results: List of agent results

        Returns:
            {"winner": str, "analysis": dict, "reasoning": str}
        """
        # Filter to valid results only
        valid_results = [r for r in results if r.get("analysis") is not None]

        if not valid_results:
            return {"winner": "none", "analysis": None, "reasoning": "无可用分析结果"}

        # Simple selection: first valid result
        # Can be extended with scoring logic
        winner_result = valid_results[0]

        return {
            "winner": winner_result.get("agent"),
            "analysis": winner_result.get("analysis"),
            "reasoning": f"自动选择 {winner_result.get('agent')}（无 judge）",
        }
