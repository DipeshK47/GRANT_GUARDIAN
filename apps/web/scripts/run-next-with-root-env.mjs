import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

const nextBinCandidates = [
  join(appDir, "node_modules/next/dist/bin/next"),
  join(repoRoot, "node_modules/next/dist/bin/next"),
];

const nextBin = nextBinCandidates.find((candidate) => existsSync(candidate));

if (!nextBin) {
  console.error(
    "Could not find the Next.js binary in either the app or repo root node_modules.",
  );
  process.exit(1);
}

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
