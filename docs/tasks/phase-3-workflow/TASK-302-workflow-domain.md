# TASK-302: modules/workflow/domain - 4 文件 (node + edge + workflow + dag)

> **阶段**: Phase 3 · **估时**: 5h · **优先级**: P1
> **上下文窗口**: 1 输入 · 4 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-302` |
| 所属阶段 | Phase 3 / workflow domain |
| 前置任务 | TASK-002, TASK-301 |
| 后置任务 | TASK-303, TASK-304, TASK-307, TASK-309, TASK-310 |
| 输出文件 | `src/main/modules/workflow/domain/{__init__.py, node.py, edge.py, workflow.py, dag.py}` |

## 2. 目标

定义 `Node`, `Edge`, `Workflow` 聚合根, `NodeType` 枚举,以及 DAG 工具函数(拓扑排序、并行分支、前驱计算)。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §2 (workflow domain 部分)

### 3.2 类型依赖

- `infra.domain.WorkflowId, NodeId` (TASK-002)

### 3.3 输出文件

1. `src/main/modules/workflow/domain/__init__.py`(空)
2. `src/main/modules/workflow/domain/node.py` - 含:
   - `class NodeType(str, Enum)`: `INPUT, OUTPUT, AGENT, DEBATE` 4 个值
   - `@dataclass class Node`: `id: NodeId`, `type: NodeType`, `data: dict`(原始 React Flow 数据), `agent: AgentReference | None`, `prompt: str | None`
3. `src/main/modules/workflow/domain/edge.py` - 含:
   - `@dataclass(frozen=True) class Edge`: `source: NodeId`, `target: NodeId`
4. `src/main/modules/workflow/domain/workflow.py` - 含:
   - `@dataclass class Workflow`: `id: WorkflowId`, `name: str`, `nodes: list[Node]`, `edges: list[Edge]`, `trigger_type: str`, `config: dict`, `status: str`
5. `src/main/modules/workflow/domain/dag.py` - 含 6 个纯函数(全部**只接收 edges**,**不**接收 `Workflow` 聚合根对象,保持纯函数语义 — 调用方负责传入 `workflow.edges`):
   - `def topological_sort(nodes: list[Node], edges: list[Edge]) -> list[NodeId]`(Kahn 算法,cycle 时返回 [])
   - `def identify_parallel_branches(nodes, edges) -> dict[NodeId, list[NodeId]]`
   - `def build_predecessors(edges: list[Edge]) -> dict[NodeId, list[NodeId]]`
   - `def find_downstream(node_id: NodeId, edges: list[Edge]) -> list[NodeId]`(纯函数 — 调用方传 `workflow.edges`,**不要**传整个 `Workflow` 对象,以保持无副作用与可测试性)
   - `def is_leaf(node_id: NodeId, edges: list[Edge]) -> bool`(纯函数 — 同上,调用方传 `workflow.edges`)
   - `def is_only_successor(node_id, pred_id, edges) -> bool`(串行链判断;纯函数 — 同上)

## 4. 详细步骤

### 4.0 准备: 创建空 `__init__.py`

```python
# Step 0: 创建空 __init__.py(占位模块入口,后续 import 必备)
import os
os.makedirs("src/main/modules/workflow/domain", exist_ok=True)
with open("src/main/modules/workflow/domain/__init__.py", "w", encoding="utf-8") as f:
    pass
```

### 4.1 node.py

1. `from enum import Enum` + `from dataclasses import dataclass`
2. `from src.main.infra.domain import NodeId, AgentReference`
3. `NodeType(str, Enum)`: 4 值,字符串值与设计文档一致("input","output","agent","debate")
4. `Node` 普通 dataclass(因为 data/agent/prompt 可能修改)

### 4.2 edge.py

1. `@dataclass(frozen=True) class Edge`: `source: NodeId`, `target: NodeId`

### 4.3 workflow.py

1. `from src.main.infra.domain import WorkflowId`
2. `Workflow` 普通 dataclass

### 4.4 dag.py

1. 6 个函数**严格按设计文档 §1.1 依赖图中 WorkflowRunner 所需能力**
2. 拓扑排序用 Kahn: 计算入度,deque 起点,逐层输出;若剩余入度>0 节点 → cycle, return []
3. 并行分支识别:同一层(level)中独立 sibling 节点分组
4. 前驱/下游/leaf/only_successor 都是简单遍历
5. **关键**: 全部为纯函数,无副作用,无状态
6. **关键(调用方契约)**: 所有 dag 函数只接收 `edges: list[Edge]`,**不**接收 `Workflow` 聚合根。WorkflowRunner 调用时应写 `find_downstream(node_id, workflow.edges)`,**禁止**写 `find_downstream(node_id, workflow)`(违反纯函数语义,且 dag.py 不应 import `Workflow` 类型 — 会形成 domain 层循环依赖)

## 5. Do Not 清单

- [ ] **Do Not #9**: 必须用 `NodeType` 枚举 — 必须用 `NodeType` 枚举
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not(纯函数契约)**: 禁止 dag.py 的 6 个函数 import `Workflow` 类型 — 签名只能 `edges: list[Edge]`,**不得**接收 `Workflow` 聚合根(避免 domain 层循环依赖,且破坏纯函数语义)

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.domain.node import Node, NodeType"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.domain.edge import Edge"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.domain.workflow import Workflow"` 退出码 0
- [ ] `python -c "from src.main.modules.workflow.domain.dag import topological_sort, identify_parallel_branches, build_predecessors, find_downstream, is_leaf, is_only_successor"` 退出码 0
- [ ] `topological_sort([Node(id="a", type=NodeType.INPUT, data={}), Node(id="b", type=NodeType.AGENT, data={})], [Edge(source="a", target="b")])` 返回 `["a","b"]`
- [ ] cycle: `topological_sort([...], [Edge("a","b"), Edge("b","a")])` 返回 `[]`
- [ ] `NodeType.AGENT.value == "agent"`
- [ ] `Edge(source="a",target="b")` 是 frozen 实例

## 7. 非目标

- 不实现 ORM(TASK-303)
- 不实现 executor(TASK-304+)
- 不实现 runner(TASK-309)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-302 交付说明

$ python -c "
from src.main.modules.workflow.domain.dag import topological_sort
from src.main.modules.workflow.domain.node import Node, NodeType
from src.main.modules.workflow.domain.edge import Edge
nodes = [Node(id='a', type=NodeType.INPUT, data={}), Node(id='b', type=NodeType.AGENT, data={})]
edges = [Edge(source='a', target='b')]
print(topological_sort(nodes, edges))
"
['a', 'b']
```
