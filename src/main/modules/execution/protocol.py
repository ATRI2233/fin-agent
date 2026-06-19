"""执行记录模块对外 Protocol 集合。

本文件是 ``modules/execution`` 对其他模块暴露的唯一接口文件,符合
TARGET_ARCHITECTURE_v2 §0 P2 (对外只暴露 Protocol) 与 §3.6.2 的契约。

包含的 Protocol:
    - ``ExecutionRecorder``: 写侧(7 个 async 方法,持久化/IO)。
    - ``ExecutionStateReader``: 读侧(5 个 sync 方法,纯查询,不阻塞事件循环)。

类型依赖:
    - ``infra.domain.TraceId / WorkflowId / ExecutionId / NodeId / SessionId``
      (TASK-002)。
    - ``infra.errors.FinAgentError`` (TASK-003)。
    - ``modules.execution.domain.execution_node.ExecutionStatus`` (TASK-202,
      当前以字符串 forward ref 推迟,见 §3.6.2)。

修订关联:
    - REVISION_NOTES_2026-06-18.md **修订 T-1**: 原属本文件的熔断器 Protocol
      已迁移至 workflow 模块(TASK-301)。execution 模块不感知熔断决策,
      只持久化 node-level failure 计数。

Do Not:
    - Do Not #1: 禁止跨模块 ``from X import _xxx``。
    - Do Not #2: 接口未对齐时禁止反射修补;须改 Protocol。
    - **修订 T-1 强约束**: 禁止在本文件出现熔断器相关关键字;execution
      模块是纯状态机 + 持久化,不感知 DAG 拓扑,更不感知熔断决策。
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from src.main.infra.domain import (
    ExecutionId,
    NodeId,
    SessionId,
    TraceId,
    WorkflowId,
)
from src.main.infra.errors import FinAgentError


# ── Protocol ──


@runtime_checkable
class ExecutionRecorder(Protocol):
    """执行记录写侧接口(7 个方法,全部 async)。

    实现约束:
        - 全部方法为 ``async def``(写侧持久化/IO,调用方会 await,例如
          TASK-309 ``WorkflowRunner`` line 82 ``await self._recorder.create_execution(...)``)。
        - ``trace_id`` 贯穿每个方法,keyword-only 不强制(本 Protocol
          沿用位置参数以保持与设计文档 §3.6.2 一致)。
        - ``record_node_failed`` 必须接收 ``error: FinAgentError``,
          用于把异常结构化持久化(Do Not #16 异常分层:经 ``AgentTimeoutError``
          / ``AgentHttp5xxError`` / ``OpencodeUnavailableError`` /
          ``McpServerError`` / ``ValidationError`` 等分类后传入)。
        - ``record_node_completed`` 必须接收 ``output: dict``,
          即节点产出的结构化数据。
    """

    async def create_execution(
        self,
        workflow_id: WorkflowId,
        params: dict,
        trace_id: TraceId,
    ) -> ExecutionId:
        """创建一次执行实例。

        Args:
            workflow_id: 所属工作流 ID。
            params: 触发执行的参数(payload)。
            trace_id: 审计/追踪 ID。

        Returns:
            新建的 ``ExecutionId``。
        """
        ...

    async def record_node_started(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        trace_id: TraceId,
    ) -> None:
        """记录节点开始执行。

        **必调契约**: 由 ``WorkflowRunner``(TASK-309 §4.1 step 4.5)在节点
        ``dispatch`` 之前调用,把 ``ExecutionNode.status`` 从 ``PENDING`` 转
        ``RUNNING`` 并记录 ``started_at``。与 ``record_node_completed`` /
        ``record_node_failed`` 配对使用(后者在 ``dispatch`` 之后调)。
        **若不调**,中间 RUNNING 状态永久丢失,审计追踪无法回答
        "node 何时开始"。

        Args:
            execution_id: 所属执行 ID。
            node_id: 当前节点 ID。
            trace_id: 审计/追踪 ID。
        """
        ...

    async def record_node_completed(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        output: dict,
        session_id: SessionId | None,
        trace_id: TraceId,
    ) -> None:
        """记录节点成功完成。

        Args:
            execution_id: 所属执行 ID。
            node_id: 当前节点 ID。
            output: 节点产出的结构化数据(必传 ``dict``)。
            session_id: 关联 session(可能为 ``None``,例如纯计算节点)。
            trace_id: 审计/追踪 ID。
        """
        ...

    async def record_node_failed(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        error: FinAgentError,
        trace_id: TraceId,
    ) -> None:
        """记录节点失败。

        Args:
            execution_id: 所属执行 ID。
            node_id: 当前节点 ID。
            error: 结构化异常实例(必传 ``FinAgentError``,用于持久化
                ``code`` / ``message`` / ``details`` / ``__cause__``)。
            trace_id: 审计/追踪 ID。
        """
        ...

    async def record_node_skipped(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
        trace_id: TraceId,
    ) -> None:
        """记录节点被跳过(例如上游失败导致下游不调度)。

        Args:
            execution_id: 所属执行 ID。
            node_id: 被跳过的节点 ID。
            trace_id: 审计/追踪 ID。
        """
        ...

    async def mark_execution(
        self,
        execution_id: ExecutionId,
        status: "ExecutionStatus",
        trace_id: TraceId,
    ) -> None:
        """把执行本身标记为指定终态。

        Args:
            execution_id: 目标执行 ID。
            status: 终态枚举(``ExecutionStatus`` 来自 TASK-202,
                当前以字符串 forward ref 推迟)。
            trace_id: 审计/追踪 ID。
        """
        ...

    async def mark_downstream_skipped(
        self,
        execution_id: ExecutionId,
        failed_node_id: NodeId,
        trace_id: TraceId,
    ) -> list[NodeId]:
        """级联跳过失败节点的所有下游节点,返回被跳过的节点 ID 列表。

        实现要点:由执行侧根据 DAG 反向邻接表查出 ``failed_node_id`` 的
        所有下游,逐个标记 ``SKIPPED``,返回 ``NodeId`` 列表供调用方
        审计/通知。

        Args:
            execution_id: 所属执行 ID。
            failed_node_id: 触发级联的失败节点 ID。
            trace_id: 审计/追踪 ID。

        Returns:
            被跳过的下游节点 ID 列表(顺序:拓扑序)。
        """
        ...


@runtime_checkable
class ExecutionStateReader(Protocol):
    """执行状态读侧接口(5 个方法,全部 sync)。

    实现约束:
        - 全部方法为 ``def``(读侧同步,纯查询,不应阻塞事件循环)。
        - 返回 ``WorkflowExecution`` / ``ExecutionNode`` 数据对象
          (由 TASK-202 域层提供)。
        - 所有方法均接收 ``execution_id``(或 ``workflow_id``)作主索引,
          无 ``trace_id`` 参数(读侧不写审计日志,审计只跟随写侧)。
    """

    def get_execution(
        self,
        execution_id: ExecutionId,
    ) -> Any | None:
        """获取一次执行的总体状态。

        Args:
            execution_id: 目标执行 ID。

        Returns:
            ``WorkflowExecution`` 数据对象(具体类型由 TASK-202 定义),
            不存在则返回 ``None``。此处以 ``Any`` 标记是为了在 TASK-202
            尚未落地时不引入循环 import 风险;实现方应返回 ``WorkflowExecution``。
        """
        ...

    def get_execution_nodes(
        self,
        execution_id: ExecutionId,
    ) -> list[Any]:
        """获取一次执行下所有节点的当前状态。

        Args:
            execution_id: 目标执行 ID。

        Returns:
            ``ExecutionNode`` 列表(可能为空:执行刚创建尚无节点记录)。
            ``Any`` 标记同 ``get_execution``,待 TASK-202 提供具体类型。
        """
        ...

    def get_failed_nodes(
        self,
        execution_id: ExecutionId,
    ) -> list[Any]:
        """获取一次执行下所有失败的节点。

        Args:
            execution_id: 目标执行 ID。

        Returns:
            状态为 ``FAILED`` 的 ``ExecutionNode`` 列表(可能为空)。
        """
        ...

    def get_node(
        self,
        execution_id: ExecutionId,
        node_id: NodeId,
    ) -> Any | None:
        """获取执行下单个节点的当前状态。

        Args:
            execution_id: 所属执行 ID。
            node_id: 目标节点 ID。

        Returns:
            ``ExecutionNode`` 数据对象,不存在则返回 ``None``。
        """
        ...

    def list_executions(
        self,
        workflow_id: WorkflowId | None = None,
        *,
        limit: int,
        offset: int,
    ) -> list[Any]:
        """列出执行记录(可按工作流过滤)。

        Args:
            workflow_id: 可选,按工作流 ID 精确过滤;``None`` 表示全量。
            limit: 返回条数上限(keyword-only)。
            offset: 分页偏移(keyword-only)。

        Returns:
            ``WorkflowExecution`` 列表(按 ``created_at`` 倒序)。
        """
        ...