import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const hasRun = args.includes("--run") || args[0] === "run";
const vitestArgs = hasRun ? args : ["--run", ...args];
const result = spawnSync("vitest", vitestArgs, {
	cwd: root,
	stdio: "inherit",
	shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
