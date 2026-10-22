import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const script = resolve("scripts/alert-repair/cli.mjs");

describe("alert repair CLI end to end", () => {
  it("persists a complete empty Slack scan, stays idle and sends no notifications", async () => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-alert-cli-"));
    const run = async (...args) =>
      JSON.parse(
        (
          await execute(process.execPath, [script, ...args], {
            env: { ...process.env, FOODFOLIO_ALERT_REPAIR_STATE: directory },
          })
        ).stdout,
      );
    try {
      const window = await run("window");
      expect(Number(window.latest) - Number(window.oldest)).toBe(43200);
      const packet = join(directory, "packet.json");
      await writeFile(
        packet,
        JSON.stringify({
          ...window,
          scanId: window.id,
          complete: true,
          messages: [],
        }),
      );
      expect(await run("ingest", packet)).toEqual({ queued: 0 });
      expect(await run("run")).toEqual({ status: "IDLE" });
      expect(await run("outbox")).toEqual([]);
      expect((await run("status")).cursor).toBe(window.latest);
      expect(
        JSON.parse(await readFile(join(directory, "state.json"), "utf8")).cases,
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not acknowledge incomplete pagination and preserves alerts for the next successful scan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-alert-pages-"));
    const run = async (...args) =>
      execute(process.execPath, [script, ...args], {
        env: { ...process.env, FOODFOLIO_ALERT_REPAIR_STATE: directory },
      });
    try {
      const window = JSON.parse((await run("window")).stdout);
      const packet = join(directory, "packet.json");
      const data = {
        ...window,
        scanId: window.id,
        complete: false,
        messages: [
          {
            ts: `${Number(window.latest) - 1}.000001`,
            text: "Fixture",
            bot_id: "monitor",
          },
        ],
      };
      await writeFile(packet, JSON.stringify(data));
      await expect(run("ingest", packet)).rejects.toThrow();
      expect(JSON.parse((await run("status")).stdout).cursor).toBeNull();
      await writeFile(packet, JSON.stringify({ ...data, complete: true }));
      expect(JSON.parse((await run("ingest", packet)).stdout)).toEqual({
        queued: 1,
      });
      expect(JSON.parse((await run("status")).stdout).cases).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
