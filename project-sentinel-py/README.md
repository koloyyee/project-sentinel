## **The "Project Sentinel" Python CLI **

**Objective:** Build a high-performance Python CLI that audits local projects, identifies technical debt (large logs, inactive environments, missing locks), and triggers optimized Bash cleanups.

---

### **Part 1: Setup & Discovery**

- **Initialization:** Use `uv init sentinel` to create a modern Python project structure.
- **Dependency:** Add `rich` (the 2026 industry standard for beautiful terminal UI, tables, and colors).
- **Task:** Create a script that accepts a directory path as a command-line argument.
- **Requirement:** Use `pathlib` (Python's object-oriented filesystem library) to verify the path exists.
- **Requirement:** Default to the current working directory if no path is provided.

### **Part 2: The "Audit" Engine**

- **Scanning:** Write a function to scan the target directory for three specific "waste" items:
  - **Inactive Environments:** Find `.venv` or `node_modules` folders that haven't been modified in over 30 days.
  - **Ghost Logs:** Locate any `.log` files larger than 10MB.
  - **Dependency Drifts:** Detect if a `pyproject.toml` (or `package.json`) exists without a corresponding lock file (`uv.lock` or `package-lock.json`).
- **Logic Tip:** Use `path.stat().st_mtime` for age and `path.stat().st_size` for file size.

### **Part 3: The "Bash Muscle"**

- **Execution:** Use Python's `subprocess` module to trigger high-speed shell commands for heavy lifting.
- **The Janitor Command:** ```bash

``` sh
  # Finds and removes logs over 10MB in the target path immediately

  find [TARGET_PATH] -name "\*.log" -type f -size +10M -delete


  ```

- **Challenge:** Write a Bash string that executes `du -sh * | sort -h | tail -n 5` to identify the top 5 largest directories in the project.

### **Part 4: The Professional Finish**

- **Output:** Use `rich.table` to display audit findings (Path, Type, Size, and Status) in a color-coded terminal grid.
- **The "Safety" Feature:** Implement a `--dry-run` flag using `argparse`.
- **Behavior:** If the flag is present, the tool prints the Bash commands it _would_ have run but skips actual execution.
