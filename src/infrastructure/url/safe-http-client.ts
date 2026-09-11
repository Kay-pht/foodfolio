import { lookup, type LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";
import { AnalysisError } from "../../application/analysis/types.js";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);
const MAX_BYTES = 5 * 1024 * 1024;

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    const range = parsed.range();
    if (range === "unicast") return true;
    if (range !== "rfc6052") return false;

    const bytes = parsed.toByteArray();
    if (bytes.length !== 16) return false;
    const embeddedIpv4 = bytes.slice(12).join(".");
    return isPublicAddress(embeddedIpv4);
  } catch {
    return false;
  }
}

export function publicLookupResult(
  addresses: LookupAddress[],
  all: boolean,
): LookupAddress | LookupAddress[] {
  const publicAddresses = addresses.filter(({ address }) =>
    isPublicAddress(address),
  );
  if (
    publicAddresses.length !== addresses.length ||
    publicAddresses.length === 0
  )
    throw new Error("Unsafe DNS result");
  return all ? publicAddresses : publicAddresses[0]!;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]"))
    return normalized.slice(1, -1);
  return normalized;
}

function validateHostname(hostname: string): void {
  const normalized = normalizeHostname(hostname);
  if (
    BLOCKED_HOSTS.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".internal")
  ) {
    throw new AnalysisError("SOURCE_UNSAFE_URL", false, "Blocked hostname");
  }
  if (ipaddr.isValid(normalized) && !isPublicAddress(normalized))
    throw new AnalysisError("SOURCE_UNSAFE_URL", false, "Blocked IP address");
}

function safeDispatcher(): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        lookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) return callback(error, "", 4);
          try {
            const result = publicLookupResult(addresses, options.all === true);
            if (Array.isArray(result)) return callback(null, result);
            return callback(null, result.address, result.family);
          } catch (lookupError) {
            return callback(
              lookupError instanceof Error
                ? lookupError
                : new Error("Unsafe DNS result"),
              "",
              4,
            );
          }
        });
      },
    },
  });
}

export interface SafeHttpResponse {
  finalUrl: string;
  statusCode: number;
  contentType: string | null;
  body: string;
}

export interface SafeHttpBinaryResponse {
  finalUrl: string;
  statusCode: number;
  contentType: string | null;
  body: Buffer;
}

export class SafeHttpClient {
  private readonly dispatcher = safeDispatcher();

  async get(input: URL): Promise<SafeHttpResponse> {
    const response = await this.getBuffer(input);
    return { ...response, body: response.body.toString("utf8") };
  }

  async getBuffer(
    input: URL,
    maxBytes = MAX_BYTES,
  ): Promise<SafeHttpBinaryResponse> {
    let current = new URL(input);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!["http:", "https:"].includes(current.protocol))
        throw new AnalysisError(
          "SOURCE_UNSAFE_URL",
          false,
          "Unsupported URL scheme",
        );
      validateHostname(current.hostname);
      let response;
      try {
        response = await request(current, {
          method: "GET",
          dispatcher: this.dispatcher,
          headers: {
            "user-agent": "Foodfolio/1.0 recipe metadata fetcher",
            accept:
              "text/html,application/xhtml+xml,application/json;q=0.8,text/plain;q=0.7",
          },
          headersTimeout: 30_000,
          bodyTimeout: 30_000,
        });
      } catch (error) {
        if (error instanceof AnalysisError) throw error;
        throw new AnalysisError(
          "SOURCE_FETCH_TIMEOUT",
          true,
          "Source request failed",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        await response.body.dump();
        if (!location || redirects === 5)
          throw new AnalysisError(
            "SOURCE_FETCH_FAILED",
            false,
            "Too many redirects",
          );
        current = new URL(
          Array.isArray(location) ? location[0]! : location,
          current,
        );
        continue;
      }
      if (response.statusCode === 429 || response.statusCode >= 500) {
        await response.body.dump();
        throw new AnalysisError(
          "SOURCE_FETCH_FAILED",
          true,
          `Source returned ${response.statusCode}`,
        );
      }
      if (response.statusCode === 401 || response.statusCode === 403) {
        await response.body.dump();
        throw new AnalysisError(
          "SOURCE_ACCESS_DENIED",
          false,
          "Source requires access",
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await response.body.dump();
        throw new AnalysisError(
          "SOURCE_FETCH_FAILED",
          false,
          `Source returned ${response.statusCode}`,
        );
      }
      const contentLength = Number(response.headers["content-length"] ?? 0);
      if (contentLength > maxBytes) {
        await response.body.dump();
        throw new AnalysisError(
          "SOURCE_CONTENT_UNAVAILABLE",
          false,
          "Source response is too large",
        );
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes)
          throw new AnalysisError(
            "SOURCE_CONTENT_UNAVAILABLE",
            false,
            "Source response is too large",
          );
        chunks.push(buffer);
      }
      const rawContentType = response.headers["content-type"];
      return {
        finalUrl: current.toString(),
        statusCode: response.statusCode,
        contentType: Array.isArray(rawContentType)
          ? (rawContentType[0] ?? null)
          : (rawContentType ?? null),
        body: Buffer.concat(chunks),
      };
    }
    throw new AnalysisError(
      "SOURCE_FETCH_FAILED",
      false,
      "Redirect handling failed",
    );
  }
}
