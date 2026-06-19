"""业务不变量 —— 不可通过环境变量覆盖的硬上限与语义常量。"""

MAX_NODES_PER_WORKFLOW: int = 20
"""单个工作流 DAG 允许的最大节点数。"""

SCHEDULER_MAX_INSTANCES: int = 1
"""APScheduler 同一任务允许的最大并发实例数。"""

MAINTENANCE_RETENTION_DAYS: int = 30
"""维护数据（日志、历史执行记录等）的保留天数。"""

ISO_8601_UTC: str = "%Y-%m-%dT%H:%M:%S.%fZ"
"""ISO 8601 UTC 时间戳格式字符串。"""
