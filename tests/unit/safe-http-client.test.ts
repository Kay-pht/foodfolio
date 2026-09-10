import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, request: requestMock };
});

import { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";

describe("SafeHttpClient hostname validation", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it.each(["http://[::1]/", "http://[::ffff:127.0.0.1]/"])(
    "rejects an internal IPv6 literal before requesting %s",
    async (url) => {
      const client = new SafeHttpClient();

      await expect(client.get(new URL(url))).rejects.toMatchObject({
        code: "SOURCE_UNSAFE_URL",
        retryable: false,
        message: "Blocked IP address",
      });
      expect(requestMock).not.toHaveBeenCalled();
    },
  );

  it("revalidates an IPv6 literal after a redirect", async () => {
    const dump = vi.fn(async () => undefined);
    requestMock.mockResolvedValueOnce({
      statusCode: 302,
      headers: { location: "http://[::1]/" },
      body: { dump },
    });
    const client = new SafeHttpClient();

    await expect(
      client.get(new URL("https://example.com/recipe")),
    ).rejects.toMatchObject({
      code: "SOURCE_UNSAFE_URL",
      retryable: false,
      message: "Blocked IP address",
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(dump).toHaveBeenCalledTimes(1);
  });

  it("returns bounded binary content for media retrieval", async () => {
    const body = Buffer.from([0, 1, 2, 255]);
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(body.length),
      },
      body: {
        async *[Symbol.asyncIterator]() {
          yield body;
        },
      },
    });
    const client = new SafeHttpClient();

    await expect(
      client.getBuffer(new URL("https://images.example/photo.jpg"), 4),
    ).resolves.toMatchObject({
      contentType: "image/jpeg",
      body,
    });
  });
});
