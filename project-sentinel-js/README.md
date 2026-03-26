# The "Project Sentinel" CLI

Objective: Build a command-line tool that "audits" a local development project, identifies "technical debt" (large files, missing dependencies, old logs), and offers a one-click Bash-powered cleanup.

## Setup & Discovery (30 mins)

Initialize a new directory: npm init -y && tsc --init.
Install only one dependency: npm install chalk (for professional-looking terminal output).
Task: Create a script that takes a directory path as an argument.
Requirement: Use the fs module to check if the path exists.
Requirement: If no path is provided, default to the current directory (process.cwd()).

## The "Audit" Engine (45 mins)

Write a TypeScript function that scans the target directory for three specific "waste" items:
Massive Folders: Find node_modules folders that haven't been touched in over 30 days.
Ghost Logs: Locate any .log files larger than 10MB.
Dependency Drifts: Check if a package.json exists but is missing a lock file (which signals an unstable environment).
Logic Tip: Use fs.statSync() to get the mtime (modified time) and size of files.

## The "Bash Muscle" (30 mins)
This is where you show off your Bash mastery. Instead of using slow Node.js loops to delete files, you will trigger optimized shell commands.
Use child_process.execSync to run a "Janitor Command."
The Command: 
```bash
# This finds and removes all .log files in the path immediately
find [TARGET_PATH] -name "*.log" -type f -delete
```

Challenge: Write a Bash string that lists the top 5 largest directories in the project so the user knows what is eating their space.

## Part 4: The Professional Finish (15 mins)
Output: Use console.table() to display the findings of your audit (File Type, Size, Status).
The "Safety" Feature: Implement a --dry-run flag. If this flag is present, the tool lists what it would do but does not execute the Bash cleanup.

