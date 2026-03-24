#!/usr/bin/env node
import { Command, type OptionValues } from "commander";
import path from "node:path";
import os from "node:os";
import fs, { opendir, stat } from "node:fs/promises";
import chalk from "chalk";



function resolvePath(input: string) {
  const value = input.trim();
  if (!value || value === "~") {
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
/**
 * - [x]: Use the fs module to check if the path exists. Requirement: If no path is provided, default to the current directory
 */
async function handlePath(dirPath: string): Promise<string> {
  let dir = process.cwd();

  if (!dirPath) {
    // Default value
    return dir;
  }
  // Handle -d argument
  const path = resolvePath(dirPath);
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      throw new Error(`${path} is not a directory.`)
    }
    // try/catch handles the non-directory path.
    dir = path
  } catch (error: any) {
    let colored = chalk.white.bgRed(dirPath)
    if (error.code === "ENOENT") {
      console.error(`Path: >>> ${colored} <<< doesn't exist.`);
    } else if (error.code === "ENOTDIR") {
      console.error(`Path: >>> ${colored} <<< is not a directory.`);
    } else {
      console.error(error.message);
    }
    // Crash the program
    process.exit(1)
  }
  return dir;
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
  const target = input.ext ?? ".log"
  const size = input.size ?? 10
  const targetPaths = await findFiles(input.root, target);
  if (targetPaths.length === 0) {
    console.log(`No ${target} files were found.`);
    return;
  }
  console.log(`=== files larger than ${size}mb ===`)
  for (const targetPath of targetPaths) {
    if (!await isLargeFile(targetPath, size)) {
      continue;
    }
    let coloredProjectTarget = chalk.yellow.underline(`${targetPath}`)
    console.log(`${coloredProjectTarget}.`)
  }
  console.log(`=== files larger than ${size}mb ===`)
}

async function rmStaleDir(input: OptionValues, days: number = 30) {

  const target = input.dir ?? "node_modules";
  const targetPaths = await findDirs(input.root, target);

  if (targetPaths.length === 0) {
    console.log(`No ${target} were found.`);
    return;
  }
  for (const targetPath of targetPaths) {
    const innerDirs = targetPath.split("/");
    const projectName: string = innerDirs.length >= 2 ?
      innerDirs[innerDirs.length - 2] : target

    if (!(await isStale(targetPath))) {
      continue;
    }
    let coloredProjectTarget = chalk.yellow.underline(`${projectName}/${target}`)
    if (input.dryRun) {
      console.log(`[DRY RUN:] ${coloredProjectTarget}  has been located but not deleted.`);
      continue;
    }

    console.log(`${coloredProjectTarget}  is older than ${days} days, initiate delete in 3 seconds.`)
    console.log("use ctrl + c to aboard.")

    for (let count = 3; count > 0; count--) {
      process.stdout.write(count + "...")
      await sleep(1000)
    }

    console.log(`\nDeleting: ${targetPath}`)
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      console.log(`${target} deleted successfully`);
    } catch (error: any) {
      if (error.code === "EACCES") {
        console.warn(`Cannot delete ${targetPath}`)
        continue;
      }
      console.error('Error while deleting directory:', error);
    }
  }
}

async function findFiles(startPath: string, targetExt: string = ".log", size: number = 10): Promise<string[]> {
  const matches: string[] = [];
  let entries;
  try {
    const info = await stat(startPath)
    if (!info.isDirectory()) {
      return matches;
    }
    entries = await fs.readdir(startPath, { withFileTypes: true });
  } catch (error: any) {

    if (error.code === "EACCES" || error.code === "EPERM") {
      console.warn(`Permission denied: Skipping ${startPath}`)
      return matches;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(startPath, entry.name);
    if (entry.isFile() &&
      path.extname(fullPath) === targetExt
      //&& await isLargeFile(fullPath, size)
    ) {
      matches.push(fullPath)
      continue;
    }

    if (entry.isDirectory()) {
      const nested = await findFiles(fullPath, targetExt, size)
      matches.push(...nested)
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
  } catch (error: any) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      console.warn(`Permission denied: Skipping ${startPath}`)
      return matches;
    }
    throw error;
  }

  for (const entry of entries) {

    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(startPath, entry.name);

    // Skip if it is not directory.
    // Found, collect, and move on.
    if (entry.name === targetName) {
      matches.push(fullPath);
      continue;
    }
    // Otherwise, recurse deeper
    const nested = await findDirs(fullPath, targetName);
    matches.push(...nested);
  }
  return matches;
}

// Dependency Drifts: Check if a package.json exists but is missing a lock file
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];

async function findDependencyDrifts(startPath: string): Promise<string[]> {
  const drifts: string[] = [];
  const entries = await fs.readdir(startPath, { withFileTypes: true });

  const names = new Set(entries.map(e => e.name));
  if (names.has("package.json") && !LOCKFILES.some(lock => names.has(lock))) {
    drifts.push(startPath);
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("node_modules")) continue;
    drifts.push(...await findDependencyDrifts(path.join(startPath, entry.name)));
  }
  return drifts;
}

/**
 * 
 * - [x]:  Find node_modules folders that haven't been touched in over 30 days. 
 * - [x]:  Ghost Logs: Locate any .log files larger than 10MB. 
 * - [x]: Dependency Drifts: Check if a package.json exists but is missing a lock file
 */
async function sentinel(input: OptionValues) {
  await rmStaleDir(input);
  await locateLgFiles(input);
  const drifts = await findDependencyDrifts(input.root)

  console.log("====== Dependency Drifts =======")
  console.log(drifts)
  console.log("====== Dependency Drifts =======")
}

async function main() {
  const program = new Command();
  program
    .name("sentinel")
    .description("the cli to help audit technical debts!")
    .option('-r, --root [root]', 'root directory to start the scanning')
    .option('-d, --dir [directory]', 'directory to be removed')
    .option('-e, --ext [extension]', 'file extension to be removed')
    .option('-s, --size [size]', 'file size in mb')
    .option("--dry-run", "dry run: simulate the process without removing.");

  program.parse(process.argv);
  const options = program.opts();
  options.root = await handlePath(options.root);
  console.log(chalk.green(options.root));
  console.log(options);
  //const node_modules = await findDirs(dir, "node_modules");
  //node_modules.forEach(async (dir) => {
  //  console.log(`is ${dir} stale? ` + await isStale(dir))
  //})

  //console.log(await isLargeFile(dir))
  await sentinel(options)
  //const files = await findFiles(dir)
  //console.log(files)
  //const d = await handlePath("./");
  //const entries = await fs.readdir(d)
  //console.log(entries)
}

main()
