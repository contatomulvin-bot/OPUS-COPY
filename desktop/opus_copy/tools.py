from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


class ToolError(RuntimeError):
    pass


def find_executable(name: str) -> str | None:
    return shutil.which(name)


def require_executable(name: str) -> str:
    path = find_executable(name)
    if not path:
        raise ToolError(f"{name} não encontrado no PATH.")
    return path


def run_process(args: list[str], *, cwd: Path | None = None, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def probe_tool(name: str, version_arg: str = "--version") -> str:
    path = require_executable(name)
    result = run_process([path, version_arg], timeout=30)
    if result.returncode != 0:
        raise ToolError(f"{name} falhou ao executar:\n{result.stderr.strip()}")
    return (result.stdout or result.stderr).splitlines()[0].strip()


def free_space_gb(path: Path) -> float:
    usage = shutil.disk_usage(path)
    return usage.free / (1024 ** 3)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
