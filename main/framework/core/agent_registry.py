from dataclasses import dataclass
from typing import Optional

@dataclass
class AgentInfo:
    name: str
    description: str
    capabilities: list
    tools: list
    mode: str = 'agent'

AGENTS = {
    'fin-orchestrator': AgentInfo(name='fin-orchestrator', description='Primary orchestrator', capabilities=['task routing', 'result merging'], tools=[], mode='orchestrator'),
    'macro-scout': AgentInfo(name='macro-scout', description='macro environment scout', capabilities=['macro analysis'], tools=['fred-search', 'market-snapshot'], mode='agent'),
    'sector-rotator': AgentInfo(name='sector-rotator', description='sector rotation radar', capabilities=['sector analysis'], tools=['sector-rotation'], mode='agent'),
    'sentiment-decoder': AgentInfo(name='sentiment-decoder', description='news sentiment decoder', capabilities=['sentiment analysis'], tools=['news-sentiment'], mode='agent'),
    'technical-chartist': AgentInfo(name='technical-chartist', description='technical chartist', capabilities=['technical analysis'], tools=['technical-levels'], mode='agent'),
    'fundamental-auditor': AgentInfo(name='fundamental-auditor', description='fundamental auditor', capabilities=['fundamental analysis'], tools=['fundamental-scan'], mode='agent'),
    'smart-money-hound': AgentInfo(name='smart-money-hound', description='smart money tracker', capabilities=['institutional tracking'], tools=['insider-trading'], mode='agent'),
    'risk-gatekeeper': AgentInfo(name='risk-gatekeeper', description='risk gatekeeper', capabilities=['risk assessment'], tools=['risk-gauge'], mode='agent'),
    'fusion-brain': AgentInfo(name='fusion-brain', description='fusion engine', capabilities=['multi-signal fusion'], tools=['signal-fusion'], mode='fusion'),
}

class AgentRegistry:
    def get_agent(self, name: str) -> Optional[AgentInfo]:
        return AGENTS.get(name)
    def list_agents(self) -> list:
        return list(AGENTS.values())
    def register_agent(self, info: AgentInfo):
        AGENTS[info.name] = info

registry = AgentRegistry()
