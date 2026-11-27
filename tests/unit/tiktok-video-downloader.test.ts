import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YtDlpTikTokVideoDownloader } from "../../src/infrastructure/tiktok/yt-dlp-video-downloader.js";
import type { VideoStreamPublisher } from "../../src/infrastructure/media/video-stream.js";

const directories: string[] = [];
const source = new URL("https://www.tiktok.com/@chef/video/123");
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function downloader(command: string, delay = vi.fn(async () => {})) {
  const directory = await mkdtemp(join(tmpdir(), "foodfolio-stream-test-"));
  directories.push(directory);
  const binaryPath = join(directory, "fixture");
  await writeFile(
    binaryPath,
    `#!/bin/sh
${command}
`,
    { mode: 0o700 },
  );
  return new YtDlpTikTokVideoDownloader(
    {
      binaryPath,
      maxAttempts: 5,
      attemptTimeoutMs: 3_000,
      retryBaseSeconds: 2,
      maxRetrySeconds: 10,
    },
    delay,
  );
}

describe("YtDlpTikTokVideoDownloader", () => {
  it("starts a fresh source stream after temporary storage failures", async () => {
    const delay = vi.fn(async () => {});
    const instance = await downloader("printf mp4-data", delay);
    const bodies: string[] = [];
    const publish: VideoStreamPublisher = vi.fn(async (media, write) => {
      const output = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          bodies.push(chunk.toString());
          callback();
        },
      });
      await write(output);
      if (bodies.length < 3) throw new Error("temporary failure");
      return {
        ...media,
        url: "https://storage.example/video",
        dispose: async () => {},
      };
    });
    await expect(instance.publish(source, publish)).resolves.toMatchObject({
      url: "https://storage.example/video",
    });
    expect(bodies).toEqual(["mp4-data", "mp4-data", "mp4-data"]);
    expect(delay.mock.calls).toEqual([[2_000], [4_000]]);
  });

  it("does not complete a written object when the child exits unsuccessfully", async () => {
    const instance = await downloader("printf partial; exit 1");
    const finish = vi.fn();
    const publish: VideoStreamPublisher = vi.fn(async (_media, write) => {
      const destination = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      destination.once("finish", finish);
      await write(destination);
      throw new Error("test expected write to fail");
    });
    await expect(instance.publish(source, publish)).rejects.toMatchObject({
      code: "TIKTOK_VIDEO_DOWNLOAD_FAILED",
      retryable: false,
    });
    expect(publish).toHaveBeenCalledTimes(5);
    expect(finish).not.toHaveBeenCalled();
  });

  it("isolates and removes downloader scratch files", async () => {
    const instance = await downloader(
      "printf fragment > ./fixture-fragment; pwd",
    );
    let scratch = "";
    const publish: VideoStreamPublisher = async (media, write) => {
      await write(
        new Writable({
          write(chunk: Buffer, _encoding, callback) {
            scratch += chunk.toString();
            callback();
          },
        }),
      );
      return {
        ...media,
        url: "https://storage.example/isolated",
        dispose: async () => {},
      };
    };
    try {
      await instance.publish(source, publish);
      expect(scratch.trim()).not.toBe(process.cwd());
      await expect(stat(scratch.trim())).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(join(process.cwd(), "fixture-fragment"), { force: true });
    }
  });

  it("fails a fragment above 32 MiB without retrying or finishing the object", async () => {
    const delay = vi.fn(async () => {});
    const instance = await downloader(
      "exec dd if=/dev/zero of=fixture-fragment bs=1048576 count=33",
      delay,
    );
    const finished = vi.fn();
    const publish: VideoStreamPublisher = vi.fn(async (_media, write) => {
      const output = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      output.once("finish", finished);
      await write(output);
      throw new Error("expected the fragment limit to stop the upload");
    });
    await expect(instance.publish(source, publish)).rejects.toMatchObject({
      code: "TIKTOK_VIDEO_DOWNLOAD_FAILED",
      retryable: false,
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });

  it("rejects non-TikTok URLs without starting an upload", async () => {
    const instance = await downloader("exit 1");
    const publish = vi.fn();
    await expect(
      instance.publish(new URL("https://example.com/video/123"), publish),
    ).rejects.toMatchObject({ code: "TIKTOK_VIDEO_URL_INVALID" });
    expect(publish).not.toHaveBeenCalled();
  });
});
