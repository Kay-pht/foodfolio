import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";

const servers = new Set<Server>();

async function startInternalServer(host: string): Promise<{
  port: number;
  getRequestCount: () => number;
}> {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("internal service");
  });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    getRequestCount: () => requestCount,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

afterEach(async () => {
  const activeServers = [...servers];
  servers.clear();
  await Promise.all(activeServers.map(closeServer));
});

describe("SafeHttpClient SSRF connection guard", () => {
  it("does not connect to an IPv6 loopback service", async () => {
    const internal = await startInternalServer("::1");
    const client = new SafeHttpClient();

    await expect(
      client.get(new URL(`http://[::1]:${internal.port}/secret`)),
    ).rejects.toMatchObject({
      code: "SOURCE_UNSAFE_URL",
      retryable: false,
      message: "Blocked IP address",
    });
    expect(internal.getRequestCount()).toBe(0);
  });

  it("does not connect through IPv4-mapped IPv6 to an IPv4 loopback service", async () => {
    const internal = await startInternalServer("127.0.0.1");
    const client = new SafeHttpClient();

    await expect(
      client.get(new URL(`http://[::ffff:127.0.0.1]:${internal.port}/secret`)),
    ).rejects.toMatchObject({
      code: "SOURCE_UNSAFE_URL",
      retryable: false,
      message: "Blocked IP address",
    });
    expect(internal.getRequestCount()).toBe(0);
  });
});
