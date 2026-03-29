import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

const command = process.platform === "win32" ? "npm.cmd" : "npm";

function startChild(label, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    const reason =
      signal !== null
        ? `${label} exited from signal ${signal}.`
        : `${label} exited with code ${code ?? 0}.`;
    console.error(reason);
    shutdown(code ?? 1);
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`Failed to start ${label}: ${error.message}`);
    shutdown(1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 250);
}

process.on("SIGINT", () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  shutdown(0);
});

process.on("SIGTERM", () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  shutdown(0);
});

console.log("Starting Grant Guardian local stack...");
console.log("- web: http://localhost:3000");
console.log("- orchestrator: http://localhost:4000");

startChild("web", ["run", "dev:web"]);
startChild("orchestrator", ["run", "dev:orchestrator"]);
