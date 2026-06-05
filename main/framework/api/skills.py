from typing import Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])

SKILLS = [
    {
        "name": "market-briefing",
        "description": "Daily market snapshot - market/sector/sentiment/technical/macro",
        "agents": [
            "macro-scout",
            "sector-rotator",
            "sentiment-decoder",
            "technical-chartist",
        ],
    },
    {
        "name": "stock-deep",
        "description": "Deep stock analysis - technical/fundamental/sentiment/smart-money",
        "agents": [
            "technical-chartist",
            "fundamental-auditor",
            "sentiment-decoder",
            "smart-money-hound",
        ],
    },
    {
        "name": "fin-review",
        "description": "Weekly review - portfolio/risk/attribution",
        "agents": ["risk-gatekeeper", "fusion-brain", "macro-scout"],
    },
    {
        "name": "position-watch",
        "description": "Position monitoring - real-time risk monitoring",
        "agents": ["risk-gatekeeper", "smart-money-hound"],
    },
]


@router.get("")
async def list_skills():
    return SKILLS


@router.post("/{name}/trigger")
async def trigger_skill(name: str, params: Optional[dict] = None):
    for s in SKILLS:
        if s["name"] == name:
            return {
                "message": f"Skill {name} triggered",
                "agents": s["agents"],
                "params": params or {},
            }
    raise HTTPException(status_code=404, detail="Skill not found")
