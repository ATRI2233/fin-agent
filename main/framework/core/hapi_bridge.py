import httpx
from typing import Optional, List
import asyncio


class HAPIBridge:
    def __init__(self, hub_url: str, api_token: str = ""):
        self.hub_url = hub_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {api_token}"} if api_token else {}
        self._semaphore = asyncio.Semaphore(10)
        self._active_sessions = {}

    async def create_session(self, cwd: str = ".") -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.hub_url}/api/cli/sessions",
                json={"cwd": cwd},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()["sessionId"]

    async def send_message(self, session_id: str, text: str) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.hub_url}/api/sessions/{session_id}/messages",
                json={"text": text},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()["messageId"]

    async def get_messages(
        self, session_id: str, offset: int = 0, limit: int = 20
    ) -> list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.hub_url}/api/sessions/{session_id}/messages",
                params={"offset": offset, "limit": limit},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def wait_for_completion(
        self, session_id: str, timeout: int = 300, poll_interval: int = 2
    ) -> str:
        start = asyncio.get_event_loop().time()
        while (asyncio.get_event_loop().time() - start) < timeout:
            msgs = await self.get_messages(session_id)
            if msgs:
                last = msgs[-1]
                if last.get("role") == "agent" and last.get("type") == "final":
                    return last.get("content", "")
            await asyncio.sleep(poll_interval)
        raise TimeoutError(f"Session {session_id} timed out after {timeout}s")

    async def abort_session(self, session_id: str):
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.hub_url}/api/sessions/{session_id}/abort", headers=self.headers
            )
            resp.raise_for_status()

    async def create_session_for_node(
        self, node_id: str, agent: str, prompt: str
    ) -> str:
        async with self._semaphore:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.hub_url}/api/cli/sessions",
                    json={"nodeId": node_id, "agent": agent, "prompt": prompt},
                    headers=self.headers,
                )
                resp.raise_for_status()
                session_id = resp.json()["sessionId"]
                self._active_sessions[session_id] = {
                    "status": "pending",
                    "node_id": node_id,
                }
                return session_id

    async def get_session_status(self, session_id: str) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.hub_url}/api/sessions/{session_id}/status", headers=self.headers
            )
            resp.raise_for_status()
            status = resp.json().get("status", "unknown")
            if session_id in self._active_sessions:
                self._active_sessions[session_id]["status"] = status
            return status

    async def cleanup_sessions(self, session_ids: List[str]) -> dict:
        results = {}
        for session_id in session_ids:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.delete(
                        f"{self.hub_url}/api/sessions/{session_id}",
                        headers=self.headers,
                    )
                    resp.raise_for_status()
                    results[session_id] = "cleaned"
                    if session_id in self._active_sessions:
                        del self._active_sessions[session_id]
            except Exception as e:
                results[session_id] = f"failed: {str(e)}"
        return results
