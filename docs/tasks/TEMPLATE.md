# TASK-NNN: <卡片标题>

> **阶段**: Phase X · **估时**: Nh/Nd · **优先级**: P0/P1/P2
> **上下文窗口**: 输入 N 个文件 · 输出 M 个文件（子代理必须严格控制在此范围）

---

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-NNN` |
| 所属阶段 | Phase X（子模块: foo） |
| 前置任务 | `TASK-XXX, TASK-YYY`（无 = 可立即开始） |
| 后置任务 | `TASK-AAA, TASK-BBB`（谁依赖我） |
| 输出文件 | `src/main/.../foo.py` |
| 修改文件 | `src/main/.../bar.py`（无则不写） |
| 测试文件 | `tests/.../test_foo.py`（建议,非强制本卡片） |

## 2. 目标

（1-2 句,说明本卡片交付什么。**不要解释为什么,只说做什么**）

## 3. 上下文范围

### 3.1 输入文件（必读,不要读其他文件）

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §X.Y
2. `src/main/<path>/<existing>.py`（如适用）

### 3.2 类型/运行时依赖（前置卡片产出）

- `infra.domain.AgentReference`（来自 TASK-002）
- `infra.errors.BizError`（来自 TASK-003）
- `infra.settings.Settings`（来自 TASK-007）

### 3.3 输出文件（必须创建,精确到路径）

1. `src/main/<path>/<file>.py` - 说明
2. `src/main/<path>/<file2>.py` - 说明

## 4. 详细步骤

1. （具体动作 1）
2. （具体动作 2）
3. （具体动作 3）
4. （如涉及 Protocol,签名按 §X.Y 设计文档照抄）
5. （如涉及 dataclass,标注 `frozen=True`）

## 5. Do Not 清单（本卡片相关,摘自设计文档 §9）

子代理必须**逐条核对**并在交付说明里打勾:

- [ ] **Do Not #X**: <规则简述> — <本卡片如何遵守>
- [ ] **Do Not #Y**: <规则简述> — <本卡片如何遵守>

## 6. 验收标准（必须**全部满足**才能标记完成）

- [ ] 文件存在: `ls <path>` 有输出
- [ ] 无导入错误: `python -c "from <module.path> import <Symbol>"` 退出码 0
- [ ] 类型签名匹配: `python -c "import inspect; sig = inspect.signature(...); ..."` 验证
- [ ] 测试通过: `pytest <test_path> -v` 全绿
- [ ] Grep 清洁: `<grep 命令>` 无结果
- [ ] （其他本卡片特定检查）

## 7. 非目标（明确不做,避免 scope creep）

- 不实现 X
- 不修改 Y（即使看上去相关,留给后续卡片）
- 不引入新依赖（除非本卡片明确允许）

## 8. 交付说明模板

完成时,子代理必须输出:

```
## TASK-NNN 交付说明

### Do Not 核对结果
- [x] Do Not #X: ...
- [x] Do Not #Y: ...

### 验收命令实际输出
$ ls <path>
<输出>

$ python -c "..."
<输出>

$ pytest ...
<输出>

$ grep ...
<输出（应为 0 行）>

### 偏离 / 备注
（如有:为什么偏离设计文档 / 哪些验收项无法 100% 满足 / 后续卡片需要知道什么）
（如无:写 "无偏离,严格按设计文档执行"）
```