from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from rich.console import Console
from rich.table import Table
from rich.text import Text

LOG_SIZE_THRESHOLD = 10 * 1024 * 1024
INACTIVE_DAYS = 30
INACTIVE_SEC = INACTIVE_DAYS * 24 * 60 * 60


@dataclass(frozen=True)
class Finding:
    path: Path
    category: str
    size_display: str
    status: str


def resolve_target(path: str | None) -> Path:
    root = Path(path).expanduser() if path else Path.cwd()
    root = root.resolve()
    if not root.exists():
        raise FileNotFoundError(f"Path does not exist: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"Not a directory: {root}")
    return root


def _format_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(n)} {unit}"
            return f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} PB"


def scan_inactive_environments(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    cutoff = time.time() - INACTIVE_SEC
    for dirpath, dirnames, _filenames in os.walk(root, topdown=True):
        dirnames[:] = [d for d in dirnames if d not in {".git", "__pycache__"}]
        base = Path(dirpath)
        pruned: list[str] = []
        for name in dirnames:
            if name not in (".venv", "node_modules"):
                continue
            target = base / name
            try:
                mtime = target.stat().st_mtime
            except OSError:
                pruned.append(name)
                continue
            if mtime < cutoff:
                age_days = int((time.time() - mtime) / 86400)
                findings.append(
                    Finding(
                        path=target,
                        category="Inactive environment",
                        size_display="—",
                        status=f"No mtime update in {age_days}+ days",
                    )
                )
            pruned.append(name)
        for name in pruned:
            if name in dirnames:
                dirnames.remove(name)
    return findings


def scan_ghost_logs(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        dirnames[:] = [d for d in dirnames if d not in {".git", "__pycache__"}]
        base = Path(dirpath)
        for fn in filenames:
            if not fn.endswith(".log"):
                continue
            fp = base / fn
            try:
                st = fp.stat()
            except OSError:
                continue
            if st.st_size <= LOG_SIZE_THRESHOLD:
                continue
            findings.append(
                Finding(
                    path=fp,
                    category="Ghost log",
                    size_display=_format_bytes(st.st_size),
                    status="Exceeds 10 MiB",
                )
            )
    return findings


def scan_dependency_drift(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        dirnames[:] = [d for d in dirnames if d not in {".git", "__pycache__"}]
        base = Path(dirpath)
        if "pyproject.toml" in filenames and "uv.lock" not in filenames:
            findings.append(
                Finding(
                    path=base / "pyproject.toml",
                    category="Dependency drift",
                    size_display="—",
                    status="pyproject.toml without uv.lock",
                )
            )
        if "package.json" in filenames and "package-lock.json" not in filenames:
            findings.append(
                Finding(
                    path=base / "package.json",
                    category="Dependency drift",
                    size_display="—",
                    status="package.json without package-lock.json",
                )
            )
    return findings


def run_audit(root: Path) -> list[Finding]:
    out: list[Finding] = []
    out.extend(scan_inactive_environments(root))
    out.extend(scan_ghost_logs(root))
    out.extend(scan_dependency_drift(root))
    out.sort(key=lambda f: str(f.path))
    return out


def janitor_find_command(target: Path) -> list[str]:
    # +10485760c matches the 10 MiB threshold on BSD/GNU find (byte count).
    return [
        "find",
        str(target),
        "-name",
        "*.log",
        "-type",
        "f",
        "-size",
        "+10485760c",
        "-delete",
    ]


def top_directories_shell_command() -> str:
    return "du -sh * 2>/dev/null | sort -h | tail -n 5"


def run_shell_command(
    argv_or_string: list[str] | str,
    *,
    cwd: Path,
    dry_run: bool,
    console: Console,
    label: str,
    shell: bool = False,
) -> None:
    if dry_run:
        if shell:
            console.print(f"[dim]{label} (dry-run):[/dim] {argv_or_string}")
        else:
            console.print(f"[dim]{label} (dry-run):[/dim] {' '.join(argv_or_string)}")
        return
    if shell:
        subprocess.run(argv_or_string, shell=True, cwd=cwd, check=False)
    else:
        subprocess.run(argv_or_string, cwd=cwd, check=False)


def render_findings_table(findings: list[Finding], console: Console) -> None:
    table = Table(title="Project Sentinel audit", show_lines=True)
    table.add_column("Path", overflow="fold")
    table.add_column("Type")
    table.add_column("Size")
    table.add_column("Status")

    for f in findings:
        if f.category == "Ghost log":
            style = "red"
        elif f.category == "Inactive environment":
            style = "yellow"
        else:
            style = "magenta"

        table.add_row(
            Text(str(f.path), style=style),
            Text(f.category, style=style),
            Text(f.size_display, style=style),
            Text(f.status, style=style),
        )

    if not findings:
        table.add_row("(none)", "—", "—", "No issues found in scan rules")
    console.print(table)


def run_top_five_dirs(root: Path, *, dry_run: bool, console: Console) -> None:
    cmd = top_directories_shell_command()
    console.print()
    console.print("[bold]Top 5 largest immediate children[/bold] (by du -sh *)")
    run_shell_command(cmd, cwd=root, dry_run=dry_run, console=console, label="Top dirs", shell=True)


def run_janitor(root: Path, *, dry_run: bool, console: Console) -> None:
    argv = janitor_find_command(root)
    run_shell_command(argv, cwd=root, dry_run=dry_run, console=console, label="Janitor (delete large logs)")


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Audit local projects for waste (stale envs, large logs, missing lockfiles) and optional cleanup.",
    )
    p.add_argument(
        "path",
        nargs="?",
        default=None,
        help="Directory to audit (default: current working directory)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print shell commands that would run; do not delete or run du output.",
    )
    return p


def main() -> int:
    console = Console()
    args = build_arg_parser().parse_args()
    try:
        root = resolve_target(args.path)
    except (FileNotFoundError, NotADirectoryError) as e:
        console.print(f"[red]{e}[/red]")
        return 1

    findings = run_audit(root)
    render_findings_table(findings, console)

    run_top_five_dirs(root, dry_run=args.dry_run, console=console)

    run_janitor(root, dry_run=args.dry_run, console=console)

    return 0


if __name__ == "__main__":
    sys.exit(main())
