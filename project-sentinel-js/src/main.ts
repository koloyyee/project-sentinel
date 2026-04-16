#!/usr/bin/env node
import chalk from "chalk";
import { Command, type OptionValues } from "commander";
import fs, { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function resolvePath(input: string) {
  const value = input.trim();
  if (!value || value === "~") {
    // MARK: os.homedir() is os agnostic
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(value);
}

async function handlePath(dirPath: string | undefined): Promise<string> {
  if (!dirPath?.trim()) {
    return process.cwd();
  }

  const resolved = resolvePath(dirPath);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new Error(`${resolved} is not a directory.`);
    }
    return resolved;
  } catch (error: unknown) {
    const colored = chalk.white.bgRed(dirPath);
    if (isNodeError(error) && error.code === "ENOENT") {
      console.error(`Path: >>> ${colored} <<< doesn't exist.`);
    } else if (isNodeError(error) && error.code === "ENOTDIR") {
      console.error(`Path: >>> ${colored} <<< is not a directory.`);
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}


async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isLargeFile(file: string, mb: number = 10): Promise<boolean> {
  const size = mb * 1024 * 1024;
  const info = await stat(file);
  return info.size >= size;
}

async function isStale(dir: string, days: number = 30) {
  const info = await stat(dir);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return info.mtime < cutoff;
}


async function locateLgFiles(input: OptionValues) {
  const target = (input.ext as string | undefined) ?? ".log";
  const sizeMb = Number(input.size) || 10;
  const targetPaths = await findFiles(input.root, target);
  if (targetPaths.length === 0) {
    console.log(`No ${target} files were found.`);
    return;
  }
  const banner = chalk.bold(`=== Files larger than ${sizeMb} MB ===`);
  console.log(banner);
  for (const targetPath of targetPaths) {
    if (!(await isLargeFile(targetPath, sizeMb))) {
      continue;
    }
    console.log(chalk.yellow.underline(targetPath));
  }
  console.log(banner);
}

async function rmStaleDir(input: OptionValues, days: number = 30) {
  const target = (input.dir as string | undefined) ?? "node_modules";
  const targetPaths = await findDirs(input.root, target);

  if (targetPaths.length === 0) {
    console.log(`No ${target} directories were found.`);
    return;
  }
  for (const targetPath of targetPaths) {
    const parent = path.dirname(targetPath);
    const projectLabel =
      parent === targetPath ? target : path.basename(parent);

    if (!(await isStale(targetPath, days))) {
      continue;
    }
    const coloredProjectTarget = chalk.yellow.underline(`${projectLabel}/${target}`);
    if (input.dryRun) {
      console.log(`[DRY RUN] ${coloredProjectTarget} would be removed (stale).`);
      continue;
    }

    console.log(
      `${coloredProjectTarget} is older than ${days} days; deleting in 3 seconds.`,
    );
    console.log("Press Ctrl+C to abort.");

    for (let count = 3; count > 0; count--) {
      process.stdout.write(`${count}...`);
      await sleep(1000);
    }

    console.log(`\nDeleting: ${targetPath}`);
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      console.log(`${target} deleted successfully.`);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "EACCES") {
        console.warn(`Cannot delete ${targetPath}`);
        continue;
      }
      console.error("Error while deleting directory:", error);
    }
  }
}

async function findFiles(
  startPath: string,
  targetExt: string = ".log",
): Promise<string[]> {
  const matches: string[] = [];
  let entries;
  try {
    const info = await stat(startPath);
    if (!info.isDirectory()) {
      return matches;
    }
    entries = await fs.readdir(startPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      isNodeError(error) &&
      (error.code === "EACCES" || error.code === "EPERM")
    ) {
      console.warn(`Permission denied: skipping ${startPath}`);
      return matches;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(startPath, entry.name);
    if (entry.isFile() && path.extname(fullPath) === targetExt) {
      matches.push(fullPath);
      continue;
    }

    if (entry.isDirectory()) {
      const nested = await findFiles(fullPath, targetExt);
      matches.push(...nested);
      continue;
    }
  }

  return matches;
}

/**
 * Collect all target directories.
 * @param startPath  User input directory, default pwd
 * @param targetName Targeted directory name, e.g.: node_modules
 * @returns An array of directory with the full path
 */
async function findDirs(startPath: string, targetName: string): Promise<string[]> {
  const matches: string[] = [];
  let entries;
  try {
    const info = await stat(startPath);

    if (!info.isDirectory()) {
      return matches;
    }
    entries = await fs.readdir(startPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      isNodeError(error) &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      console.warn(`Permission denied: skipping ${startPath}`);
      return matches;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(startPath, entry.name);

    if (entry.name === targetName) {
      matches.push(fullPath);
      continue;
    }
    const nested = await findDirs(fullPath, targetName);
    matches.push(...nested);
  }
  return matches;
}

const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
] as const;

async function findDependencyDrifts(startPath: string): Promise<string[]> {
  const drifts: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(startPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      isNodeError(error) &&
      (error.code === "EACCES" || error.code === "EPERM")
    ) {
      console.warn(`Permission denied: skipping ${startPath}`);
      return drifts;
    }
    throw error;
  }

  const names = new Set(entries.map((e) => e.name));
  if (names.has("package.json") && !LOCKFILES.some((lock) => names.has(lock))) {
    drifts.push(startPath);
  }

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      entry.name === "node_modules"
    ) {
      continue;
    }
    drifts.push(
      ...(await findDependencyDrifts(path.join(startPath, entry.name))),
    );
  }
  return drifts;
}

async function sentinel(input: OptionValues) {
  await rmStaleDir(input);
  await locateLgFiles(input);
  const drifts = await findDependencyDrifts(input.root);

  const driftBanner = chalk.bold("=== Dependency drifts (package.json without lockfile) ===");
  console.log(driftBanner);
  if (drifts.length === 0) {
    console.log("None found.");
  } else {
    console.table(
      drifts.map((projectPath) => ({
        project: projectPath,
      })),
    );
  }
  console.log(driftBanner);
}

async function main() {
  const program = new Command();
  program
    .name("sentinel")
    .description("Audit local projects for stale dirs, large logs, and missing lockfiles.")
    .option(
      "-r, --root <path>",
      "root directory to scan (default: current directory)",
    )
    .option(
      "-d, --dir <name>",
      'directory name to prune when stale (default: "node_modules")',
    )
    .option("-e, --ext <ext>", 'file extension for large-file scan (default: ".log")')
    .option("-s, --size <mb>", "large-file threshold in MB (default: 10)", "10")
    .option("--dry-run", "list stale targets without deleting them");

  program.parse(process.argv);
  const options = program.opts();
  options.root = await handlePath(options.root as string | undefined);
  await sentinel(options);
}

main();
