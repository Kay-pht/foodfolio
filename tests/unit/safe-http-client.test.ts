import type { LookupAddress } from "node:dns";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, request: requestMock };
});

import {
  isPublicAddress,
  publicLookupResult,
  SafeHttpClient,
} from "../../src/infrastructure/url/safe-http-client.js";

describe("SafeHttpClient DNS validation", () => {
  it("accepts a mixed public IPv4 and RFC 6052 NAT64 DNS result", () => {
    const addresses: LookupAddress[] = [
      { address: "93.184.216.34", family: 4 },
      { address: "64:ff9b::5db8:d822", family: 6 },
    ];

    expect(publicLookupResult(addresses, true)).toEqual(addresses);
    expect(isPublicAddress("64:ff9b::5db8:d822")).toBe(true);
  });

  it.each(["64:ff9b::a00:1", "64:ff9b::7f00:1"])(
    "rejects RFC 6052 NAT64 when the embedded IPv4 is not public: %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
      expect(() =>
        publicLookupResult(
          [
            { address: "93.184.216.34", family: 4 },
            { address, family: 6 },
          ],
          true,
        ),
      ).toThrow("Unsafe DNS result");
    },
  );
});

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

  it("classifies Undici connection timeouts as timeouts", async () => {
    requestMock.mockRejectedValueOnce(
      Object.assign(new Error("private connect detail"), {
        name: "ConnectTimeoutError",
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    );
    const client = new SafeHttpClient();

    let failure: unknown;
    try {
      await client.get(new URL("https://example.com/recipe"));
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "SOURCE_FETCH_TIMEOUT",
      retryable: true,
      diagnostics: {
        sourceOperation: "source_fetch",
        sourceFailureStage: "request",
        sourceFailureClass: "timeout",
        sourceRedirectCount: 0,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private connect detail");
  });

  it("records privacy-safe HTTP diagnostics for source failures", async () => {
    const dump = vi.fn(async () => undefined);
    requestMock.mockResolvedValueOnce({
      statusCode: 503,
      headers: {},
      body: { dump },
    });
    const client = new SafeHttpClient();

    await expect(
      client.get(
        new URL("https://www.tiktok.com/oembed?url=example"),
        "tiktok_oembed",
      ),
    ).rejects.toMatchObject({
      code: "SOURCE_FETCH_FAILED",
      retryable: true,
      diagnostics: {
        sourceOperation: "tiktok_oembed",
        sourceFailureStage: "response_status",
        sourceFailureClass: "http_error",
        sourceHttpStatus: 503,
        sourceRedirectCount: 0,
      },
    });
    expect(dump).toHaveBeenCalledOnce();
  });

  it("records the redirect stage without logging redirect URLs", async () => {
    const dump = vi.fn(async () => undefined);
    requestMock.mockResolvedValueOnce({
      statusCode: 302,
      headers: {},
      body: { dump },
    });
    const client = new SafeHttpClient();

    await expect(
      client.get(
        new URL("https://lite.tiktok.com/t/example/"),
        "tiktok_short_url",
      ),
    ).rejects.toMatchObject({
      code: "SOURCE_FETCH_FAILED",
      retryable: false,
      diagnostics: {
        sourceOperation: "tiktok_short_url",
        sourceFailureStage: "redirect",
        sourceFailureClass: "redirect_missing_location",
        sourceHttpStatus: 302,
        sourceRedirectCount: 1,
      },
    });
    expect(dump).toHaveBeenCalledOnce();
  });

  it("normalizes failures while discarding a response body", async () => {
    const bodyError = Object.assign(new Error("do not log this"), {
      code: "UND_ERR_BODY_TIMEOUT",
    });
    const dump = vi.fn(async () => {
      throw bodyError;
    });
    requestMock.mockResolvedValueOnce({
      statusCode: 503,
      headers: {},
      body: { dump },
    });
    const client = new SafeHttpClient();

    let failure: unknown;
    try {
      await client.get(
        new URL("https://www.tiktok.com/oembed?url=example"),
        "tiktok_oembed",
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "INTERNAL_ANALYSIS_ERROR",
      retryable: true,
      diagnostics: {
        sourceOperation: "tiktok_oembed",
        sourceFailureStage: "response_body",
        sourceFailureClass: "timeout",
        sourceHttpStatus: 503,
        sourceRedirectCount: 0,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("do not log this");
  });

  it("normalizes failures while streaming a successful response body", async () => {
    const bodyError = Object.assign(new Error("private network detail"), {
      code: "ECONNRESET",
    });
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: { "content-type": "text/html" },
      body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from("partial");
          throw bodyError;
        },
      },
    });
    const client = new SafeHttpClient();

    let failure: unknown;
    try {
      await client.get(new URL("https://example.com/recipe"));
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "INTERNAL_ANALYSIS_ERROR",
      retryable: true,
      diagnostics: {
        sourceOperation: "source_fetch",
        sourceFailureStage: "response_body",
        sourceFailureClass: "network",
        sourceHttpStatus: 200,
        sourceRedirectCount: 0,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private network detail");
  });

  it("normalizes a malformed redirect Location", async () => {
    const dump = vi.fn(async () => undefined);
    requestMock.mockResolvedValueOnce({
      statusCode: 302,
      headers: { location: "http://[" },
      body: { dump },
    });
    const client = new SafeHttpClient();

    await expect(
      client.get(
        new URL("https://lite.tiktok.com/t/example/"),
        "tiktok_short_url",
      ),
    ).rejects.toMatchObject({
      code: "SOURCE_FETCH_FAILED",
      retryable: false,
      diagnostics: {
        sourceOperation: "tiktok_short_url",
        sourceFailureStage: "redirect",
        sourceFailureClass: "redirect_invalid_location",
        sourceHttpStatus: 302,
        sourceRedirectCount: 1,
      },
    });
    expect(dump).toHaveBeenCalledOnce();
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
