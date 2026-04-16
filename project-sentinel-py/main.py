from __future__ import annotations
from dataclasses import dataclass
import sys
import argparse
from pathlib import Path

@dataclass(frozen=True)
class Finding:
  path: Path
  category: str
  size_display: str
  status: str

def build_arg_parser() -> argparse.ArgumentParser :
  
  parser = argparse.ArgumentParser()
  parser.add_argument(
    "path",
    nargs="?",
    default=None, 
    help="Directory to audit (default: current working directory)",
  )
  parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print shell commands that would run; do not delete or run du output.",
    )
  return parser

def resolve_target(path: str | None) -> Path:
  root = Path(path).expanduser() if path else Path.cwd()
  root = root.resolve()
  if not root.exists():
    raise FileExistsError(f"Path does not exist: {root}")
  if not root.is_dir():
    raise NotADirectoryError(f"Not a directory: {root}")
  return root

def main() -> int:
  args = build_arg_parser().parse_args()
  try:
    root = resolve_target(args.path)
  except:

    return 1

if __name__ == "__main__":
  main()