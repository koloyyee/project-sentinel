import { program, type OptionValues } from "commander";
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
async function handlePath(input: OptionValues): Promise<string> {
  let dir = process.cwd();

  if (!input.dir) {
    // Default value
    return dir;
  }
  // Handle -d argument
  const path = resolvePath(input.dir);
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      throw new Error(`${path} is not a directory.`)
    }
    // try/catch handles the non-directory path.
    dir = path
  } catch (error: any) {
    let colored = chalk.white.bgRed(input.dir)
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

/**
 * 
 * - [x]:  Find node_modules folders that haven't been touched in over 30 days. 
 * - [ ]:  Ghost Logs: Locate any .log files larger than 10MB. 
 * - [ ]: Dependency Drifts: Check if a package.json exists but is missing a lock file
 */
async function sentinel(dir: string) {
  await rmStaleDir(dir, "del_me", 15)
}

async function rmStaleDir(dir: string, target: string = "node_modules", days: number = 30) {

  const targetPath = await findDir(dir, target);
  if (!targetPath) {
    console.log(`No ${target} was found.`);
    return;
  }

  const info = await stat(targetPath);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  if (info.mtime < cutoff) {
    console.log(`${target} is older than ${days} days, initiate delete in 3 seconds.`)
    console.log("use ctrl + c to aboard.")

    let count = 3;
    const timer = setInterval(async () => {

      process.stdout.write(count + "...")
      if (count === 0) {
        clearInterval(timer);
        console.log(`\nDeleting: ${targetPath}`)
        try {
          await fs.rm(targetPath, { recursive: true, force: true });
          console.log(`${target} deleted successfully`);
        } catch (err) {
          console.error('Error while deleting directory:', err);
        }
      }
      count--;
    }, 1000)
  }
}
async function findDir(startPath: string, targetName: string): Promise<string | null> {
  const entries = await fs.readdir(startPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(startPath, entry.name);

    if (entry.isDirectory()) {
      // Check if this is the directory we are looking for
      if (entry.name === targetName) {
        return fullPath;
      }
      // Otherwise, recurse deeper
      const found = await findDir(fullPath, targetName);
      if (found) return found;
    }
  }
  return null;
}
async function main() {
  program
    .name("project sentinel")
    .description("the cli to help audit technical debts!")
    .option('-d, --dir [directory]', 'input target directory');

  program.parse(process.argv);
  const options = program.opts();
  const dir = await handlePath(options);
  console.log(chalk.green(dir));
  await sentinel(dir)
}

main()
