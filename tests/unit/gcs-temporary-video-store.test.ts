import { once } from "node:events";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { File, Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";
import { GcsTemporaryVideoStore } from "../../src/infrastructure/tiktok/gcs-temporary-video-store.js";

describe("GcsTemporaryVideoStore", () => {
  it.each([true, false])(
    "requires a matching checksum before signing (%s)",
    async (valid) => {
      const video = Buffer.from("video");
      const sourceStorage = new Storage();
      const checksum = sourceStorage.crc32cGenerator();
      checksum.update(valid ? video : Buffer.from("other data"));
      const getSignedUrl = vi
        .spyOn(File.prototype, "getSignedUrl")
        .mockResolvedValue(["https://storage.example/signed"]);
      const operations: string[] = [];
      let received:
        | { method?: string; path?: string; contentType?: string; body: string }
        | undefined;
      const server = createServer(async (request, response) => {
        operations.push(request.method ?? "");
        if (request.method === "DELETE") {
          response.writeHead(204).end();
          return;
        }
        const blocks: Buffer[] = [];
        for await (const block of request) blocks.push(block as Buffer);
        received = {
          method: request.method,
          path: request.url,
          contentType: request.headers["content-type"],
          body: Buffer.concat(blocks).toString(),
        };
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ crc32c: checksum.toString() }));
      }).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No test address");
      const storage = new Storage({
        apiEndpoint: `http://127.0.0.1:${address.port}`,
        useAuthWithCustomEndpoint: false,
      });
      vi.spyOn(storage.authClient, "getRequestHeaders").mockResolvedValue({});
      const store = new GcsTemporaryVideoStore("private-video-bucket", storage);
      const before = Date.now();
      try {
        const publishing = store.publishStream(
          { index: 1, kind: "video", contentType: "video/mp4" },
          (destination) => pipeline(Readable.from([video]), destination),
        );
        if (valid) {
          const published = await publishing;
          expect(published.url).toBe("https://storage.example/signed");
          const signedOptions = getSignedUrl.mock.calls[0]?.[0] as {
            expires?: number;
          };
          expect(signedOptions.expires).toBeGreaterThanOrEqual(
            before + 10 * 60 * 1000,
          );
          expect(signedOptions.expires).toBeLessThanOrEqual(
            Date.now() + 10 * 60 * 1000,
          );
          await published.dispose();
        } else {
          await expect(publishing).rejects.toMatchObject({
            code: "TIKTOK_VIDEO_PUBLISH_FAILED",
          });
          expect(getSignedUrl).not.toHaveBeenCalled();
        }
        expect(received).toMatchObject({
          method: "POST",
          path: expect.stringMatching(
            /^\/upload\/storage\/v1\/b\/private-video-bucket\/o\?uploadType=multipart&name=pending%2F.+\.mp4$/,
          ),
          contentType: expect.stringMatching(/^multipart\/related; boundary=/),
        });
        expect(received?.body).toContain(
          '"cacheControl":"private, no-store, max-age=0"',
        );
        expect(received?.body).toContain(
          "Content-Type: video/mp4\r\n\r\nvideo\r\n",
        );
        expect(operations).toEqual(["POST", "DELETE"]);
      } finally {
        getSignedUrl.mockRestore();
        server.closeAllConnections();
        server.close();
      }
    },
  );
});
