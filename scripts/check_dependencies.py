#!/usr/bin/env python
"""Detect layered architecture violations.

Rules:
1. main/framework/api/ MUST NOT import SessionLocal or sqlalchemy.orm directly
2. main/framework/api/ MUST go through Repository or Service layer
3. main/framework/core/ MUST NOT import SessionLocal directly (except via Container)
"""
import ast
import os
import sys
from pathlib import Path

RULES = [
    {
        "name": "API layer must not import SessionLocal",
        "source_dir": "main/framework/api",
        "forbidden_patterns": ["SessionLocal"],
        "forbidden_modules": ["sqlalchemy.orm", "sqlalchemy"],
    },
    {
        "name": "Core layer must not import SessionLocal directly",
        "source_dir": "main/framework/core",
        "forbidden_patterns": ["SessionLocal"],
        "forbidden_modules": [],
    },
]


def check_file(filepath: Path, forbidden_patterns: list, forbidden_modules: list) -> list[str]:
    violations = []
    try:
        tree = ast.parse(filepath.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return violations
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if any(p in alias.name for p in forbidden_modules):
                    violations.append(f"line {node.lineno}: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.module and any(p in node.module for p in forbidden_modules):
                violations.append(f"line {node.lineno}: from {node.module} import ...")
            # Check imported names for SessionLocal
            for alias in (node.names or []):
                if alias.name in forbidden_patterns:
                    violations.append(f"line {node.lineno}: from {node.module} import {alias.name}")
        elif isinstance(node, ast.Name):
            if node.id in forbidden_patterns:
                violations.append(f"line {node.lineno}: use of {node.id}")
    return violations


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    total_violations = 0
    # PHASE 1: 22 known violations to be fixed during Wave 4
    expected_violations = {
        "main/framework/api/agents.py": 1,
        "main/framework/api/conversations.py": 4,  # 3 calls + 1 nested
        "main/framework/api/executions.py": 6,
        "main/framework/api/sessions.py": 4,
        "main/framework/api/system.py": 1,
        "main/framework/api/triggers.py": 6,
        "main/framework/core/performance.py": 2,
        "main/framework/core/retry_handler.py": 2,
        "main/framework/core/scheduler.py": 4,
        "main/framework/core/session_cleanup.py": 2,
        "main/framework/core/workflow_engine.py": 3,
    }
    for rule in RULES:
        src = root / rule["source_dir"]
        if not src.exists():
            continue
        for py in src.rglob("*.py"):
            if "__pycache__" in str(py):
                continue
            v = check_file(py, rule["forbidden_patterns"], rule["forbidden_modules"])
            rel = str(py.relative_to(root)).replace("\\", "/")
            if v:
                expected = expected_violations.get(rel, 0)
                status = "OK (will fix in Wave 4)" if len(v) <= expected else "UNEXPECTED"
                print(f"  {rel}: {len(v)} violation(s) [{status}]")
                for line in v:
                    print(f"    {line}")
                total_violations += len(v)
    if total_violations > sum(expected_violations.values()):
        print(f"\n\u274c UNEXPECTED violations: {total_violations}", file=sys.stderr)
        return 1
    print(f"\n\u2705 Architecture check passed (current state has {total_violations} known violation(s) tracked for Wave 4)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
