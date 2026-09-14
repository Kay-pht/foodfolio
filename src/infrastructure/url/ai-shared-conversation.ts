import { Agent, request } from "undici";
import { AnalysisError } from "../../application/analysis/types.js";
import { sourceTypeForUrl } from "../../domain/recipe/url.js";

const MAX_PROVIDER_BODY_BYTES = 5 * 1024 * 1024;
const GEMINI_MAX_HEADER_BYTES = 128 * 1024;
const GEMINI_RPC = "ujx1Bf";

export interface OrderedConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface SharedConversation {
  resolvedUrl: string;
  messages: OrderedConversationMessage[];
}

export interface SharedConversationAdapter {
  extract(url: URL): Promise<SharedConversation>;
}

export interface TextHttpClient {
  get(url: URL): Promise<{ finalUrl: string; body: string }>;
}

export interface GeminiTransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface GeminiTransport {
  get(url: URL): Promise<GeminiTransportResponse>;
  post(
    url: URL,
    body: string,
    headers: Record<string, string>,
  ): Promise<GeminiTransportResponse>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized || null;
}

function valueAt(value: unknown, path: number[]): unknown {
  let current = value;
  for (const index of path) {
    if (!Array.isArray(current)) return undefined;
    current = current[index];
  }
  return current;
}

function extractScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1] ?? "",
  );
}

function findCallArgument(
  text: string,
  startIndex: number,
): { argument: string; endIndex: number } | null {
  let quote: string | null = null;
  let escaped = false;
  let depth = 1;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0)
        return {
          argument: text.slice(startIndex, index).trim(),
          endIndex: index + 1,
        };
    }
  }
  return null;
}

function parseLoaderArgument(argument: string): unknown[] | null {
  let value: unknown = argument.trim();
  if (typeof value === "string" && value.startsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value.trim());
    } catch {
      return null;
    }
  }
  return Array.isArray(value) ? value : null;
}

function extractLoader(html: string): unknown[] | null {
  const call = "streamController.enqueue(";
  for (const script of extractScripts(html)) {
    let start = 0;
    while (start < script.length) {
      const anchor = script.indexOf(call, start);
      if (anchor < 0) break;
      const found = findCallArgument(script, anchor + call.length);
      if (!found) break;
      const loader = parseLoaderArgument(found.argument);
      if (loader) return loader;
      start = found.endIndex;
    }
  }
  return null;
}

function decodeLoader(loader: unknown[]): Record<string, unknown> {
  const cache = new Map<number, unknown>();
  const resolve = (value: unknown): unknown => {
    if (typeof value === "number" && Number.isInteger(value)) {
      if (cache.has(value)) return cache.get(value);
      if (value < 0 || value >= loader.length) return value;
      cache.set(value, null);
      const resolved = resolve(loader[value]);
      cache.set(value, resolved);
      return resolved;
    }
    if (Array.isArray(value)) return value.map(resolve);
    const record = asRecord(value);
    if (!record) return value;
    return Object.fromEntries(
      Object.entries(record).map(([rawKey, item]) => {
        const match = /^_(\d+)$/.exec(rawKey);
        const keyValue = match ? loader[Number(match[1])] : null;
        const key = typeof keyValue === "string" ? keyValue : rawKey;
        return [key, resolve(item)];
      }),
    );
  };

  const decoded: Record<string, unknown> = {};
  for (let index = 1; index < loader.length - 1; index += 2) {
    const key = loader[index];
    if (typeof key === "string" && !(key in decoded))
      decoded[key] = resolve(loader[index + 1]);
  }
  return decoded;
}

function findConversationData(root: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [root];
  let visited = 0;
  while (queue.length && visited < 20_000) {
    visited += 1;
    const current = queue.shift();
    const record = asRecord(current);
    if (record) {
      if (
        asRecord(record.mapping) &&
        (typeof record.current_node === "string" ||
          Array.isArray(record.linear_conversation))
      )
        return record;
      queue.push(...Object.values(record));
    } else if (Array.isArray(current)) queue.push(...current);
  }
  return null;
}

function textFromChatGptMessage(
  message: Record<string, unknown>,
): string | null {
  const content = asRecord(message.content);
  if (!content || !Array.isArray(content.parts)) return null;

  const parts: string[] = [];
  for (const part of content.parts) {
    const direct = normalizeText(part);
    if (direct) {
      parts.push(direct);
      continue;
    }

    const record = asRecord(part);
    if (!record) continue;
    const text = record.text;
    if (typeof text === "string") {
      const normalized = normalizeText(text);
      if (normalized) parts.push(normalized);
    } else if (Array.isArray(text)) {
      for (const item of text) {
        const normalized = normalizeText(item);
        if (normalized) parts.push(normalized);
      }
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

function messagesFromChatGptData(
  data: Record<string, unknown>,
): OrderedConversationMessage[] {
  const mapping = asRecord(data.mapping) ?? {};
  let nodes: Record<string, unknown>[] = [];

  if (typeof data.current_node === "string") {
    const reversed: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let current: string | null = data.current_node;
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = asRecord(mapping[current]);
      if (!node) break;
      reversed.push(node);
      current = typeof node.parent === "string" ? node.parent : null;
    }
    nodes = reversed.reverse();
  } else if (Array.isArray(data.linear_conversation)) {
    nodes = data.linear_conversation
      .map((entry) => {
        const record = asRecord(entry);
        const id = record && typeof record.id === "string" ? record.id : null;
        return (id ? asRecord(mapping[id]) : null) ?? record;
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  const messages: OrderedConversationMessage[] = [];
  for (const node of nodes) {
    const message = asRecord(node.message);
    if (!message) continue;
    const metadata = asRecord(message.metadata);
    if (metadata?.is_visually_hidden_from_conversation === true) continue;
    const author = asRecord(message.author);
    const role = author?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textFromChatGptMessage(message);
    if (text) messages.push({ role, text });
  }
  return messages;
}

function legacyChatGptData(html: string): Record<string, unknown> | null {
  const match =
    /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    );
  if (!match?.[1]) return null;
  try {
    return findConversationData(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

export function parseChatGptShareHtml(
  html: string,
): OrderedConversationMessage[] {
  const loader = extractLoader(html);
  const data = loader ? findConversationData(decodeLoader(loader)) : null;
  const conversation = data ?? legacyChatGptData(html);
  if (!conversation)
    throw new AnalysisError(
      "SHARED_CONVERSATION_FORMAT_CHANGED",
      false,
      "ChatGPT shared conversation payload was not recognized",
    );

  const messages = messagesFromChatGptData(conversation);
  if (!messages.length)
    throw new AnalysisError(
      "SOURCE_CONTENT_UNAVAILABLE",
      false,
      "ChatGPT shared conversation contains no visible user or assistant messages",
    );
  return messages;
}

export class ChatGptSharedConversationAdapter implements SharedConversationAdapter {
  constructor(private readonly http: TextHttpClient) {}

  async extract(url: URL): Promise<SharedConversation> {
    if (sourceTypeForUrl(url) !== "chatgpt")
      throw new AnalysisError(
        "SHARED_CONVERSATION_INVALID_URL",
        false,
        "URL is not a supported ChatGPT public share",
      );
    const response = await this.http.get(url);
    return {
      resolvedUrl: response.finalUrl,
      messages: parseChatGptShareHtml(response.body),
    };
  }
}

async function bodyToBoundedText(
  body: AsyncIterable<unknown>,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > MAX_PROVIDER_BODY_BYTES)
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "Shared conversation response is too large",
      );
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class UndiciGeminiTransport implements GeminiTransport {
  private readonly dispatcher = new Agent({
    maxHeaderSize: GEMINI_MAX_HEADER_BYTES,
  });

  async get(url: URL): Promise<GeminiTransportResponse> {
    return this.send(url, "GET");
  }

  async post(
    url: URL,
    body: string,
    headers: Record<string, string>,
  ): Promise<GeminiTransportResponse> {
    return this.send(url, "POST", body, headers);
  }

  private async send(
    url: URL,
    method: "GET" | "POST",
    body?: string,
    headers?: Record<string, string>,
  ): Promise<GeminiTransportResponse> {
    try {
      const response = await request(url, {
        method,
        dispatcher: this.dispatcher,
        headersTimeout: 30_000,
        bodyTimeout: 30_000,
        ...(headers ? { headers } : {}),
        ...(body !== undefined ? { body } : {}),
      });
      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: await bodyToBoundedText(response.body),
      };
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      throw new AnalysisError(
        "SHARED_CONVERSATION_FETCH_FAILED",
        true,
        "Gemini shared conversation request failed",
      );
    }
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function geminiCanonicalPath(url: URL): string | null {
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (host !== "gemini.google.com" || segments[0] !== "share" || !segments[1])
    return null;
  return `/share/${segments[1]}`;
}

function ensureProviderResponse(statusCode: number, provider: string): void {
  if (statusCode === 429 || statusCode >= 500)
    throw new AnalysisError(
      "SHARED_CONVERSATION_FETCH_FAILED",
      true,
      `${provider} shared conversation is temporarily unavailable`,
    );
  if (statusCode === 401 || statusCode === 403)
    throw new AnalysisError(
      "SHARED_CONVERSATION_ACCESS_DENIED",
      false,
      `${provider} shared conversation is not publicly accessible`,
    );
  if (statusCode < 200 || statusCode >= 400)
    throw new AnalysisError(
      "SHARED_CONVERSATION_FETCH_FAILED",
      false,
      `${provider} shared conversation request was rejected`,
    );
}

export function parseGeminiBatchResponse(
  text: string,
): OrderedConversationMessage[] {
  let payload: unknown;
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim().startsWith("[[")) continue;
    try {
      const rows: unknown = JSON.parse(line);
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (
          Array.isArray(row) &&
          row[0] === "wrb.fr" &&
          row[1] === GEMINI_RPC &&
          typeof row[2] === "string"
        )
          payload = JSON.parse(row[2]);
      }
    } catch {
      // Google batches unrelated records in the same response; malformed lines are ignored.
    }
  }

  const turns = valueAt(payload, [0, 1]);
  if (!Array.isArray(turns))
    throw new AnalysisError(
      "SHARED_CONVERSATION_FORMAT_CHANGED",
      false,
      "Gemini shared conversation payload was not recognized",
    );

  const messages: OrderedConversationMessage[] = [];
  for (const turn of turns) {
    const user = normalizeText(valueAt(turn, [2, 0]));
    if (user) messages.push({ role: "user", text: user });

    const candidates = valueAt(turn, [3, 0]);
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      const parts = valueAt(candidate, [1]);
      if (!Array.isArray(parts)) continue;
      const assistant = parts
        .map(normalizeText)
        .filter((part): part is string => part !== null)
        .join("\n\n")
        .trim();
      if (assistant) {
        messages.push({ role: "assistant", text: assistant });
        break;
      }
    }
  }

  if (!messages.length)
    throw new AnalysisError(
      "SOURCE_CONTENT_UNAVAILABLE",
      false,
      "Gemini shared conversation contains no user or assistant messages",
    );
  return messages;
}

export class GeminiSharedConversationAdapter implements SharedConversationAdapter {
  constructor(
    private readonly transport: GeminiTransport = new UndiciGeminiTransport(),
  ) {}

  async canonicalize(input: URL): Promise<URL> {
    const existingPath = geminiCanonicalPath(input);
    if (existingPath)
      return new URL(`https://gemini.google.com${existingPath}`);

    const host = input.hostname.toLowerCase().replace(/^www\./, "");
    const segments = input.pathname.split("/").filter(Boolean);
    if (
      input.protocol !== "https:" ||
      host !== "share.gemini.google" ||
      !segments[0]
    )
      throw new AnalysisError(
        "SHARED_CONVERSATION_INVALID_URL",
        false,
        "URL is not a supported Gemini public share",
      );

    let current = new URL(`https://share.gemini.google/${segments[0]}`);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await this.transport.get(current);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = headerValue(response.headers, "location");
        if (!location || redirects === 5)
          throw new AnalysisError(
            "SHARED_CONVERSATION_FORMAT_CHANGED",
            false,
            "Gemini short share did not resolve to a canonical share",
          );

        const next = new URL(location, current);
        const nextHost = next.hostname.toLowerCase().replace(/^www\./, "");
        if (
          next.protocol !== "https:" ||
          !["share.gemini.google", "gemini.google.com"].includes(nextHost)
        )
          throw new AnalysisError(
            "SHARED_CONVERSATION_FORMAT_CHANGED",
            false,
            "Gemini short share redirected outside the public share hosts",
          );

        const canonicalPath = geminiCanonicalPath(next);
        if (canonicalPath)
          return new URL(`https://gemini.google.com${canonicalPath}`);
        current = next;
        continue;
      }

      ensureProviderResponse(response.statusCode, "Gemini");
      const canonicalPath = geminiCanonicalPath(current);
      if (canonicalPath)
        return new URL(`https://gemini.google.com${canonicalPath}`);
      throw new AnalysisError(
        "SHARED_CONVERSATION_FORMAT_CHANGED",
        false,
        "Gemini short share did not resolve to a canonical share",
      );
    }

    throw new AnalysisError(
      "SHARED_CONVERSATION_FORMAT_CHANGED",
      false,
      "Gemini short share redirect limit was exceeded",
    );
  }

  async extract(url: URL): Promise<SharedConversation> {
    const canonical = await this.canonicalize(url);
    const shareId = canonical.pathname.split("/").filter(Boolean)[1];
    if (!shareId)
      throw new AnalysisError(
        "SHARED_CONVERSATION_INVALID_URL",
        false,
        "Gemini canonical share ID is missing",
      );

    const endpoint = new URL(
      "https://gemini.google.com/_/BardChatUi/data/batchexecute",
    );
    endpoint.search = new URLSearchParams({
      rpcids: GEMINI_RPC,
      "source-path": `/share/${shareId}`,
      hl: "en-US",
      rt: "c",
    }).toString();
    const inner = JSON.stringify([null, shareId, [4]]);
    const fReq = JSON.stringify([[[GEMINI_RPC, inner, null, "generic"]]]);
    const response = await this.transport.post(
      endpoint,
      new URLSearchParams({ "f.req": fReq }).toString(),
      {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
        origin: "https://gemini.google.com",
        referer: "https://gemini.google.com/",
      },
    );
    ensureProviderResponse(response.statusCode, "Gemini");
    return {
      resolvedUrl: canonical.toString(),
      messages: parseGeminiBatchResponse(response.body),
    };
  }
}

export class ProductionRecipeUrlCanonicalizer {
  constructor(private readonly gemini: GeminiSharedConversationAdapter) {}

  async canonicalize(input: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return input;
    }
    if (sourceTypeForUrl(url) !== "gemini") return input;
    return (await this.gemini.canonicalize(url)).toString();
  }
}
