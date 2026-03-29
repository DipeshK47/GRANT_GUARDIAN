import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptDir, "..");
const repoRoot = join(appDir, "../..");

const { loadEnvConfig } = nextEnv;
loadEnvConfig(repoRoot);

const command = process.argv[2];
if (command === "build" || command === "start") {
  process.env.NODE_ENV = "production";
} else if (command === "dev") {
  process.env.NODE_ENV = "development";
}

const nextBin = join(repoRoot, "node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  cwd: appDir,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
