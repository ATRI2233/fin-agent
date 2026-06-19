"""Agent 模块对外 Protocol 集合。

本文件是 ``modules/agent`` 对其他模块暴露的唯一接口文件,符合
TARGET_ARCHITECTURE_v2 §0 P2 (对外只暴露 Protocol) 与 §3.6.1 的契约。

包含的 Protocol:
    - ``DispatchResult``: TypedDict,``dispatch()`` 的返回类型。
    - ``AgentDispatcher``: 高层调度(会话复用、超时、结构化错误分类)。
    - ``AgentBackend``: 底层 opencode HTTP 传输,仅 ``AgentDispatcher`` 使用,不向外暴露。
    - ``SessionManager``: ``conversation_id`` ↔ ``session_id`` 双向绑定。

修订关联:
    - REVISION_NOTES_2026-06-18.md **修订 T-3**: ``dispatch_parallel`` 第二个返回
      ``list[SessionId]`` 为 debate-style 辅助 session_id,不得与
      ``results[i].session_id`` 重叠。
    - REVISION_NOTES_2026-06-18.md **Bug C-4 设计变更**: ``dispatch_parallel.trace_id``
      扩展为 ``TraceId | list[TraceId] | None``,以兼容:
        1. 单 trace_id 广播(默认行为);
        2. 每个 worker 独立 trace_id(Phase 1.5 ``test_parallel_trace_isolation``)。

Do Not:
    - Do Not #1: 禁止跨模块 ``from X import _xxx``。
    - Do Not #2: 接口未对齐时禁止反射修补;须改 Protocol。
    - Do Not #16: agent 层异常须 catch 后包成
      ``AgentTimeoutError`` / ``AgentHttp5xxError`` / ``McpServerError`` 之一。
"""

from __future__ import annotations

from typing import Any, Protocol, TypedDict, runtime_checkable

from src.main.infra.domain import (
    AgentReference,
    ConversationId,
    SessionId,
    TraceId,
)


# ── TypedDict ──


class DispatchResult(TypedDict):
    """``AgentDispatcher.dispatch`` 的返回结构。

    Attributes:
        result: 解析后的结构化结果(由 ``session.output_parser`` 产出);
                类型 ``Any`` 是因为不同 Agent 的输出 schema 不固定。
        session_id: 本次 dispatch 使用的 ``SessionId``(主 session)。
        raw: opencode 返回的原始字符串(用于审计/debug)。
    """

    result: Any
    session_id: SessionId
    raw: str


# ── Protocol ──


@runtime_checkable
class AgentDispatcher(Protocol):
    """高层 Agent 调度:负责会话复用、超时、结构化错误分类。

    实现约束:
        - 全部方法为 ``async``。
        - ``trace_id`` 为 keyword-only 参数,禁止隐式依赖 ContextVar
          (TARGET_ARCHITECTURE_v2 §7.6)。
        - 异常须包成 ``AgentTimeoutError`` / ``AgentHttp5xxError`` /
          ``OpencodeUnavailableError`` / ``McpServerError`` /
          ``ValidationError`` 之一(Do Not #16)。
    """

    async def dispatch(
        self,
        agent: AgentReference,
        prompt: str,
        *,
        timeout: float | None = None,
        session_id: SessionId | None = None,
        reuse_session: bool = False,
        trace_id: TraceId,
    ) -> DispatchResult:
        """单 Agent 调度。

        Args:
            agent: 目标 Agent 引用。
            prompt: 用户/上游 prompt 文本。
            timeout: 超时秒数;``None`` 表示使用
                ``settings.NODE_TIMEOUT_SECONDS``。
            session_id: 显式指定要复用的 session;``None`` 表示新开。
            reuse_session: 是否在同一 conversation 内复用最近一个 session。
            trace_id: 审计/追踪 ID,keyword-only,贯穿整个调用链。

        Returns:
            ``DispatchResult`` TypedDict。

        Raises:
            AgentTimeoutError: 超时。
            AgentHttp5xxError: opencode 返回 5xx。
            OpencodeUnavailableError: opencode 进程不可用。
            McpServerError: MCP 子进程错误。
            ValidationError: prompt/参数不合法。
        """
        ...

    async def dispatch_parallel(
        self,
        agents: list[AgentReference],
        prompt: str,
        *,
        timeout: float | None = None,
        trace_id: TraceId | list[TraceId] | None = None,
    ) -> tuple[list[DispatchResult], list[SessionId]]:
        """Fan-out 调度:对一组独立 Agent 并行 dispatch。

        ``trace_id`` 模式(**Bug C-4 设计变更**):
            - 单值 ``TraceId``: 广播给所有 worker,每个 ``DispatchResult.raw``
              对应同一 trace_id。
            - ``list[TraceId]``: 一一对应 ``agents``,``len`` 必须等于
              ``len(agents)``;每个 worker 独立 trace_id,用于
              ``test_parallel_trace_isolation`` 验证 ContextVar 隔离。
            - ``None``(默认): dispatcher 自生成单一 trace_id 并广播
              给所有 worker。

        Args:
            agents: 目标 Agent 引用列表(顺序敏感,``trace_id`` 列表按此对齐)。
            prompt: 共享 prompt。
            timeout: 超时秒数。
            trace_id: 见上述三种模式。

        Returns:
            ``(results, extra_session_ids)``:
                - ``results``: 与 ``agents`` 并行,每个元素含独立的主
                  ``session_id``(写入 ``results[i].session_id``)。
                - ``extra_session_ids``: debate-style 辅助 session_id
                  (例如同一 dispatch 中开的追问 session)。**禁止与
                  ``results[i].session_id`` 重叠**;调用方用此列表填入
                  ``NodeResult.extra_data["debate_session_ids"]``
                  (修订 T-3)。

        Raises:
            同 ``dispatch``;任一 worker 失败即从首个失败者抛出。
        """
        ...


@runtime_checkable
class AgentBackend(Protocol):
    """底层 opencode HTTP 传输。

    仅供 ``AgentDispatcher`` 内部调用,不向外模块暴露。
    所有方法含 ``trace_id: TraceId`` 参数(审计/追踪传透);
    ``wait_for_completion`` 也必须含 ``trace_id``,不可省略(任务卡 §3.2)。
    """

    async def create_session(
        self,
        agent: AgentReference,
        trace_id: TraceId,
    ) -> SessionId:
        """创建 opencode session,返回 ``SessionId``。"""
        ...

    async def send_message(
        self,
        session_id: SessionId,
        text: str,
        agent: AgentReference | None,
        trace_id: TraceId,
    ) -> None:
        """向已有 session 发送消息。"""
        ...

    async def wait_for_completion(
        self,
        session_id: SessionId,
        *,
        timeout: float,
        after_count: int,
        trace_id: TraceId,
    ) -> str:
        """阻塞等待 session 完成,返回原始输出字符串。

        Args:
            session_id: 目标 session。
            timeout: 超时秒数。
            after_count: 已发送消息计数,用于 opencode 完成判定。
            trace_id: 审计/追踪 ID,keyword-only。

        Returns:
            opencode 返回的 raw 文本。
        """
        ...

    async def abort_session(self, session_id: SessionId) -> None:
        """中止单个 session。"""
        ...

    async def cleanup_sessions(
        self,
        ids: list[SessionId],
    ) -> dict[SessionId, str]:
        """批量清理 sessions,返回 ``{session_id: status}`` 映射。"""
        ...

    async def close(self) -> None:
        """关闭 backend(释放 HTTP 连接池等)。"""
        ...


@runtime_checkable
class SessionManager(Protocol):
    """``conversation_id`` ↔ ``session_id`` 双向绑定。

    实现约束:
        - 全部方法为 ``async``(任务卡 §4.7)。
    """

    async def bind(
        self,
        conversation_id: ConversationId,
        session_id: SessionId,
    ) -> None:
        """绑定 ``conversation_id`` 到 ``session_id``(后者覆盖前者)。"""
        ...

    async def lookup(
        self,
        conversation_id: ConversationId,
    ) -> SessionId | None:
        """查询 ``conversation_id`` 对应的 ``session_id``;无绑定返回 ``None``。"""
        ...