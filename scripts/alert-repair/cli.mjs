import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acknowledge,
  beginScan,
  readState,
  reserveBudget,
  saveState,
} from "./core.mjs";
import { processQueue, command } from "./runner.mjs";

export async function withLock(directory, callback) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "process.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    if (!Number.isSafeInteger(existing.pid) || existing.pid <= 0)
      throw new Error("Invalid process lock; human reconciliation required.");
    try {
      process.kill(existing.pid, 0);
    } catch (failure) {
      if (failure.code !== "ESRCH") throw failure;
      await rm(lockPath);
      return withLock(directory, callback);
    }
    throw new Error("Another alert-repair process is active.");
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    return await callback();
  } finally {
    await handle.close();
    await rm(lockPath);
  }
}

export async function externalValidation(
  directory,
  state,
  caseId,
  adapterId,
  requestId,
  now = Date.now(),
) {
  const incident = state.cases.find((entry) => entry.id === caseId);
  if (!incident) throw new Error("Unknown incident.");
  // This file is human-managed outside the writable agent checkout. No adapter
  // is installed by default: guessing a price must never initiate a paid call.
  const adapters = JSON.parse(
    await readFile(join(directory, "external-adapters.json"), "utf8"),
  );
  const adapter = Object.hasOwn(adapters, adapterId)
    ? adapters[adapterId]
    : undefined;
  if (
    !adapter ||
    !isAbsolute(adapter.command) ||
    !Array.isArray(adapter.args) ||
    adapter.args.some((arg) => typeof arg !== "string") ||
    !/^https:\/\//.test(adapter.pricingEvidence ?? "") ||
    !(Date.parse(adapter.validUntil) > now) ||
    !Array.isArray(adapter.environmentKeys)
  ) {
    throw new Error(
      "Missing trusted adapter with a current, evidenced maximum JPY charge.",
    );
  }
  const reservation = reserveBudget(incident, {
    id: requestId,
    maximumMilliYen: adapter.maximumMilliYen,
    purpose: adapterId,
  });
  if (reservation.executed)
    throw new Error(
      "Request was already attempted; never retry a possibly charged API call with the same ID.",
    );
  reservation.executed = true;
  await saveState(directory, state); // Reserve the full maximum *before* calling.
  const outputPath = join(directory, incident.id, `external-${requestId}.txt`);
  const env = {
    PATH: process.env.PATH,
    HOME: join(directory, incident.id),
    LANG: "en_US.UTF-8",
  };
  for (const key of adapter.environmentKeys) {
    if (
      !/^[A-Z][A-Z0-9_]+$/.test(key) ||
      !process.env[key] ||
      [
        "HOME",
        "PATH",
        "CODEX_HOME",
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
      ].includes(key)
    )
      throw new Error("Invalid or unavailable external-adapter credential.");
    env[key] = process.env[key];
  }
  const output = command(adapter.command, adapter.args, {
    env,
    input: JSON.stringify({ caseId: incident.id, purpose: adapterId }),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
  await writeFile(outputPath, output, { mode: 0o600 });
  return {
    caseId,
    requestId,
    reservedMilliYen: reservation.maximumMilliYen,
    evidence: outputPath,
  };
}

export async function cli(args, directory) {
  return withLock(directory, async () => {
    const state = await readState(directory);
    const [action, ...parameters] = args;
    let output;
    if (action === "window") output = beginScan(state);
    else if (action === "ingest") {
      const { ingest } = await import("./core.mjs");
      output = {
        queued: ingest(
          state,
          JSON.parse(await readFile(parameters[0], "utf8")),
        ),
      };
    } else if (action === "run") {
      const incident = await processQueue({ state, directory });
      output = incident
        ? {
            id: incident.id,
            status: incident.status,
            pr: incident.pr,
            reason: incident.reason,
          }
        : { status: "IDLE" };
    } else if (action === "outbox")
      output = state.outbox.filter((entry) => !entry.delivered);
    else if (action === "ack") {
      acknowledge(state, parameters[0], parameters[1]);
      output = { acknowledged: parameters[0] };
    } else if (action === "external")
      output = await externalValidation(directory, state, ...parameters);
    else if (action === "status")
      output = {
        cursor: state.cursor,
        scan: state.scan,
        cases: state.cases.map((entry) => ({
          id: entry.id,
          status: entry.status,
          fixes: entry.fixes,
          pr: entry.pr,
          reason: entry.reason,
          workspace: entry.workspace,
          reservedMilliYen: entry.budget.reduce(
            (sum, reservation) => sum + reservation.maximumMilliYen,
            0,
          ),
          sessions: entry.sessions.map(({ id, role }) => ({ id, role })),
        })),
        pendingNotifications: state.outbox.filter((entry) => !entry.delivered)
          .length,
      };
    else
      throw new Error(
        "Use window | ingest <packet.json> | run | outbox | ack <id> <Slack-ts> | status | external <case-id> <adapter-id> <request-id>.",
      );
    await saveState(directory, state);
    return output;
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const gitDirectory = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim();
    const directory =
      process.env.FOODFOLIO_ALERT_REPAIR_STATE ??
      join(gitDirectory, "foodfolio", "alert-repair");
    process.stdout.write(
      `${JSON.stringify(await cli(process.argv.slice(2), directory), null, 2)}\n`,
    );
  } catch (error) {
    // Third-party stderr may contain request/secret material. Preserve raw
    // execution evidence locally, and publish only our bounded error message.
    process.stderr.write(
      `${error.code ? `${error.code}: ` : ""}${error.message.split("\n")[0]}\n`,
    );
    process.exitCode = 1;
  }
}
