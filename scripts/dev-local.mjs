import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parse } from "dotenv";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const environmentPath = resolve(
  repositoryRoot,
  process.env.FOODFOLIO_LOCAL_ENV ?? ".env.local",
);

if (!existsSync(environmentPath)) {
  console.error(
    `Missing ${environmentPath}. Copy .env.local.example to .env.local and fill the required API keys.`,
  );
  process.exit(1);
}

const environment = {
  ...parse(readFileSync(environmentPath)),
  ...process.env,
};

const defaults = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://foodfolio:foodfolio@127.0.0.1:5432/foodfolio",
  DATABASE_DIRECT_URL:
    "postgresql://foodfolio:foodfolio@127.0.0.1:5432/foodfolio",
  ANALYSIS_QUEUE_DRIVER: "local-http",
  WORKER_URL: "http://127.0.0.1:8081",
  NOTIFICATION_DRIVER: "noop",
  GOOGLE_CLOUD_PROJECT: "foodfolio-af28aa",
};
for (const [key, value] of Object.entries(defaults)) {
  environment[key] ??= value;
}

const missing = ["ZAI_API_KEY", "YOUTUBE_API_KEY"].filter(
  (key) => !environment[key]?.trim(),
);
if (missing.length > 0) {
  console.error(`Missing local environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

run("docker", ["compose", "up", "-d", "postgres"]);

let postgresReady = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "foodfolio",
      "-d",
      "foodfolio",
    ],
    { cwd: repositoryRoot, env: environment, stdio: "ignore" },
  );
  if (result.status === 0) {
    postgresReady = true;
    break;
  }
  await delay(500);
}
if (!postgresReady) {
  console.error("Local PostgreSQL did not become ready within 30 seconds.");
  process.exit(1);
}

run("npm", ["run", "prisma:generate"]);
run("npm", ["run", "prisma:migrate:deploy"]);

const processes = [
  {
    name: "worker",
    child: spawn("npm", ["run", "dev:worker"], {
      cwd: repositoryRoot,
      env: { ...environment, PORT: "8081" },
      stdio: "inherit",
    }),
  },
  {
    name: "api",
    child: spawn("npm", ["run", "dev:api"], {
      cwd: repositoryRoot,
      env: { ...environment, PORT: "8080" },
      stdio: "inherit",
    }),
  },
];

let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const { child } of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

for (const { name, child } of processes) {
  child.on("error", (error) => {
    console.error(`Failed to start local ${name}`, error);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `Local ${name} exited unexpectedly (${signal ?? `code ${code ?? 1}`}).`,
    );
    stop(code ?? 1);
  });
}

await Promise.all(
  processes.map(
    ({ child }) =>
      new Promise((resolveClose) => child.once("close", resolveClose)),
  ),
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
