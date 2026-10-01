import { lookup, type LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";
import {
  AnalysisError,
  type AnalysisFailureDiagnostics,
  type SourceFailureClass,
  type SourceFailureOperation,
  type SourceFailureStage,
} from "../../application/analysis/types.js";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);
const MAX_BYTES = 5 * 1024 * 1024;

function requestFailureClass(error: unknown): SourceFailureClass {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : null;
    const name = typeof record.name === "string" ? record.name : null;
    if (
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT" ||
      name === "ConnectTimeoutError" ||
      name === "TimeoutError" ||
      name === "AbortError"
    )
      return "timeout";
  }
  return "network";
}

function sourceDiagnostics(
  operation: SourceFailureOperation,
  stage: SourceFailureStage,
  failureClass: SourceFailureClass,
  redirectCount: number,
  httpStatus?: number,
): AnalysisFailureDiagnostics {
  return {
    sourceOperation: operation,
    sourceFailureStage: stage,
    sourceFailureClass: failureClass,
    sourceRedirectCount: redirectCount,
    ...(httpStatus !== undefined ? { sourceHttpStatus: httpStatus } : {}),
  };
}

function sourceBodyFailure(
  error: unknown,
  operation: SourceFailureOperation,
  redirectCount: number,
  httpStatus: number,
): AnalysisError {
  return new AnalysisError(
    "SOURCE_FETCH_FAILED",
    true,
    "Source response body failed",
    undefined,
    sourceDiagnostics(
      operation,
      "response_body",
      requestFailureClass(error),
      redirectCount,
      httpStatus,
    ),
  );
}

async function dumpResponseBody(
  body: { dump(): Promise<unknown> },
  operation: SourceFailureOperation,
  redirectCount: number,
  httpStatus: number,
): Promise<void> {
  try {
    await body.dump();
  } catch (error) {
    throw sourceBodyFailure(error, operation, redirectCount, httpStatus);
  }
}

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

  async get(
    input: URL,
    operation: SourceFailureOperation = "source_fetch",
  ): Promise<SafeHttpResponse> {
    const response = await this.getBuffer(input, MAX_BYTES, operation);
    return { ...response, body: response.body.toString("utf8") };
  }

  async getBuffer(
    input: URL,
    maxBytes = MAX_BYTES,
    operation: SourceFailureOperation = "source_fetch",
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
          undefined,
          sourceDiagnostics(
            operation,
            "request",
            requestFailureClass(error),
            redirects,
          ),
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        await dumpResponseBody(
          response.body,
          operation,
          redirects,
          response.statusCode,
        );
        if (!location || redirects === 5)
          throw new AnalysisError(
            "SOURCE_FETCH_FAILED",
            false,
            "Too many redirects",
            undefined,
            sourceDiagnostics(
              operation,
              "redirect",
              location ? "redirect_limit" : "redirect_missing_location",
              redirects + 1,
              response.statusCode,
            ),
          );
        try {
          current = new URL(
            Array.isArray(location) ? location[0]! : location,
            current,
          );
        } catch {
          throw new AnalysisError(
            "SOURCE_FETCH_FAILED",
            false,
            "Redirect location is invalid",
            undefined,
            sourceDiagnostics(
              operation,
              "redirect",
              "redirect_invalid_location",
              redirects + 1,
              response.statusCode,
            ),
          );
        }
        continue;
      }
      if (response.statusCode === 429 || response.statusCode >= 500) {
        await dumpResponseBody(
          response.body,
          operation,
          redirects,
          response.statusCode,
        );
        throw new AnalysisError(
          "SOURCE_FETCH_FAILED",
          true,
          `Source returned ${response.statusCode}`,
          undefined,
          sourceDiagnostics(
            operation,
            "response_status",
            "http_error",
            redirects,
            response.statusCode,
          ),
        );
      }
      if (response.statusCode === 401 || response.statusCode === 403) {
        await dumpResponseBody(
          response.body,
          operation,
          redirects,
          response.statusCode,
        );
        throw new AnalysisError(
          "SOURCE_ACCESS_DENIED",
          false,
          "Source requires access",
          undefined,
          sourceDiagnostics(
            operation,
            "response_status",
            "http_error",
            redirects,
            response.statusCode,
          ),
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await dumpResponseBody(
          response.body,
          operation,
          redirects,
          response.statusCode,
        );
        throw new AnalysisError(
          "SOURCE_FETCH_FAILED",
          false,
          `Source returned ${response.statusCode}`,
          undefined,
          sourceDiagnostics(
            operation,
            "response_status",
            "http_error",
            redirects,
            response.statusCode,
          ),
        );
      }
      const contentLength = Number(response.headers["content-length"] ?? 0);
      if (contentLength > maxBytes) {
        await dumpResponseBody(
          response.body,
          operation,
          redirects,
          response.statusCode,
        );
        throw new AnalysisError(
          "SOURCE_CONTENT_UNAVAILABLE",
          false,
          "Source response is too large",
          undefined,
          sourceDiagnostics(
            operation,
            "response_size",
            "response_too_large",
            redirects,
            response.statusCode,
          ),
        );
      }
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk);
          total += buffer.length;
          if (total > maxBytes)
            throw new AnalysisError(
              "SOURCE_CONTENT_UNAVAILABLE",
              false,
              "Source response is too large",
              undefined,
              sourceDiagnostics(
                operation,
                "response_size",
                "response_too_large",
                redirects,
                response.statusCode,
              ),
            );
          chunks.push(buffer);
        }
      } catch (error) {
        if (error instanceof AnalysisError) throw error;
        throw sourceBodyFailure(
          error,
          operation,
          redirects,
          response.statusCode,
        );
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
      undefined,
      sourceDiagnostics(operation, "redirect", "redirect_limit", 6),
    );
  }
}
