#!/usr/bin/env python
"""Check no source file exceeds 500 lines (PHASE1 refactor guard)."""
import os
import sys

MAX_LINES = 500
EXCLUDE_DIRS = {'node_modules', 'dist', '.git', '__pycache__', 'venv', '.venv',
                 '.opencode', 'data', 'deploy', '.omo'}
INCLUDE_EXT = ('.py', '.ts', '.tsx')


def check_file(path: str) -> tuple[bool, int]:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            n = sum(1 for _ in f)
    except (UnicodeDecodeError, PermissionError):
        return True, 0
    return n <= MAX_LINES, n


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    failed = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith('.git')]
        for fn in filenames:
            if not fn.endswith(INCLUDE_EXT):
                continue
            full = os.path.join(dirpath, fn)
            ok, n = check_file(full)
            if not ok:
                rel = os.path.relpath(full, root)
                print(f"\u274c {rel}: {n} lines (exceeds {MAX_LINES})", file=sys.stderr)
                failed.append(rel)
    if failed:
        print(f"\n{len(failed)} file(s) exceed {MAX_LINES} lines", file=sys.stderr)
        return 1
    print(f"\u2705 All source files within {MAX_LINES} lines")
    return 0


if __name__ == '__main__':
    sys.exit(main())
