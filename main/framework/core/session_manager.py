from typing import Optional

from main.framework.core.protocols import AgentBackend


class SessionManager:
    def __init__(self, backend: AgentBackend):
        self._backend = backend
        self._boundaries: dict[str, set[str]] = {}
        self._node_to_boundary: dict[str, str] = {}

    def create_session_boundary(self, node_ids: list[int | str]) -> str:
        boundary_id = f"boundary_{len(self._boundaries) + 1}"
        self._boundaries[boundary_id] = set(str(n) for n in node_ids)
        for node_id in node_ids:
            self._node_to_boundary[str(node_id)] = boundary_id
        return boundary_id

    def get_boundary_sessions(self) -> dict[str, set[str]]:
        return dict(self._boundaries)

    def get_session_for_node(self, node_id: int | str) -> Optional[str]:
        boundary_id = self._node_to_boundary.get(str(node_id))
        if boundary_id:
            return boundary_id
        return None

    async def cleanup_session(self, session_id: str) -> dict:
        return await self._backend.cleanup_sessions([session_id])

    async def cleanup_all_sessions(self) -> dict:
        all_boundary_ids = list(self._boundaries.keys())
        results = {}
        if all_boundary_ids:
            results = await self._backend.cleanup_sessions(all_boundary_ids)
        self._boundaries.clear()
        self._node_to_boundary.clear()
        return results
