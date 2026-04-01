# Project Sentinel

## Purpose

Project Sentinel is a command-line tool that audits a directory tree on disk, surfaces common sources of waste and dependency inconsistency, and optionally runs fast, shell-based cleanup steps. It is meant for day-to-day maintenance of local workspaces, CI sandboxes, or shared project folders.

The reference implementation may use any language; this document describes _what_ the tool should do, not _how_ it must be built.

---

## Goals

- **Discover** problems quickly over large trees without manual browsing.
- **Report** findings in a structured, scannable way (path, category, size where relevant, human-readable status).
- **Act** deliberately: destructive operations are clearly separated from read-only audit output, with a safe preview mode.
- **Delegate** heavy filesystem work to the host shell where that is faster or simpler than a pure standard-library walk.

---

## CLI behavior

### Arguments

- Accept a **target path** (directory root to audit). If omitted, use the process **current working directory**.
- Resolve and validate the path before scanning: the path must exist and refer to a directory.

### Flags

- **`--dry-run` (or equivalent):** Perform the audit and print any shell commands that would be executed for cleanup or auxiliary reporting, but **do not** run them. This is the primary safety mechanism for destructive steps.

---

## Audit rules

All rules apply recursively under the target root unless an implementation explicitly documents pruning (for example skipping version-control metadata directories) for performance.

### Inactive environments

- **What:** Directories named `.venv` or `node_modules`.
- **Signal:** The directory is flagged if its last modification time is **older than 30 days** relative to the run time (same notion of “mtime” the host OS provides for directories).
- **Reporting:** Path, category, optional size if the implementation can obtain it cheaply, and status text describing staleness (for example approximate age in days).

### Ghost logs

- **What:** Files whose names end with `.log`.
- **Signal:** File size **strictly greater than 10 MiB** (10 × 1024 × 1024 bytes, unless the implementation documents a different interpretation consistently with the cleanup step).
- **Reporting:** Path, category, formatted size, and status indicating it exceeds the threshold.

### Dependency drift

- **What:** Manifest present without a lockfile beside it in the same directory.

| If this file exists | Then this file should also exist (same directory) |
| ------------------- | ------------------------------------------------- |
| `pyproject.toml`    | `uv.lock`                                         |
| `package.json`      | `package-lock.json`                               |

- **Reporting:** Path (typically the manifest file), category, and status describing the missing lock artifact.

---

## Shell integration

Implementations may invoke the host shell for high-throughput operations.

### Janitor (destructive)

After the audit (and subject to `--dry-run`), the tool may remove large log files in one shot using a `find`-style invocation equivalent to:

- Under the target root: delete regular files named like `*.log` whose size is over the same threshold used in the audit (10 MiB), using whatever `find` size syntax is correct on the host (byte-accurate options are preferred for parity with the audit).

In `--dry-run` mode, print the exact command line (or structured equivalent) that would run; do not delete.

### Largest immediate children (informational)

The tool should also surface the **five largest immediate subdirectories or files** of the target directory, equivalent to running in that directory:

```text
du -sh * | sort -h | tail -n 5
```

Adapt for shells and `du` variants as needed; preserve the intent (human-readable sizes, sorted ascending, last five = largest among children). In `--dry-run` mode, either print the command that would run or skip execution per product choice, but stay consistent with the “no surprise side effects” principle for anything destructive.

---

## Presentation

- Present audit results in a **tabular** layout: at minimum **Path**, **Type** (or category), **Size** (or a placeholder when not applicable), **Status**.
- Use **visual emphasis** (color, icons, or labels) so severities or categories are easy to spot at a glance, without requiring a specific terminal UI library.

---

## Non-goals

- Prescribing a package manager, test framework, or UI library.
- Guaranteeing behavior on every operating system; document supported platforms and any `find`/`du` assumptions.

---

## Success criteria

- Running against a known fixture tree produces expected hits for each rule.
- `--dry-run` never performs deletes or other irreversible shell side effects defined as destructive in this document.
- Default path behavior (no argument) matches “audit where I am now.”
