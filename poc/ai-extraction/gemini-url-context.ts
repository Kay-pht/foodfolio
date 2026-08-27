import type { Usage } from "./types.js";

const MODEL = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 4_000;

export interface GeminiUrlContextResponse {
  model: string;
  outputText: string;
  usage: Usage;
  elapsedMs: number;
  requestId: string | null;
  retrievals: Array<{ url: string; status: string }>;
  rawResponse: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function parseGeminiUrlContextResponse(
  value: Record<string, unknown>,
): Pick<GeminiUrlContextResponse, "outputText" | "usage" | "retrievals"> {
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const candidate = record(candidates[0]);
  const parts = Array.isArray(record(candidate.content).parts)
    ? (record(candidate.content).parts as unknown[])
    : [];
  const outputText = parts
    .map((part) => record(part).text)
    .filter((text): text is string => typeof text === "string")
    .join("");
  const metadata = record(
    candidate.urlContextMetadata ?? candidate.url_context_metadata,
  );
  const urlMetadata = Array.isArray(
    metadata.urlMetadata ?? metadata.url_metadata,
  )
    ? ((metadata.urlMetadata ?? metadata.url_metadata) as unknown[])
    : [];
  const retrievals = urlMetadata.map((item) => {
    const entry = record(item);
    return {
      url: String(entry.retrievedUrl ?? entry.retrieved_url ?? ""),
      status: String(
        entry.urlRetrievalStatus ?? entry.url_retrieval_status ?? "UNKNOWN",
      ),
    };
  });
  const usageMetadata = record(value.usageMetadata ?? value.usage_metadata);
  return {
    outputText,
    usage: {
      inputTokens:
        numberValue(
          usageMetadata.promptTokenCount ?? usageMetadata.prompt_token_count,
        ) +
        numberValue(
          usageMetadata.toolUsePromptTokenCount ??
            usageMetadata.tool_use_prompt_token_count,
        ),
      outputTokens:
        numberValue(
          usageMetadata.candidatesTokenCount ??
            usageMetadata.candidates_token_count,
        ) +
        numberValue(
          usageMetadata.thoughtsTokenCount ??
            usageMetadata.thoughts_token_count,
        ),
      cachedInputTokens: numberValue(
        usageMetadata.cachedContentTokenCount ??
          usageMetadata.cached_content_token_count,
      ),
    },
    retrievals,
  };
}

export async function callGeminiUrlContext(
  url: string,
  schema: Record<string, unknown>,
  apiKey = process.env.GEMINI_API_KEY,
): Promise<GeminiUrlContextResponse> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const startedAt = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Extract recipe facts only from this exact public URL: ${url}. Do not infer missing facts. Return JSON matching the supplied schema.`,
              },
            ],
          },
        ],
        tools: [{ url_context: {} }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  const raw = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      `${response.status} non-JSON API response: ${raw.slice(0, 300)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} API error: ${JSON.stringify(value).slice(0, 600)}`,
    );
  }
  const rawResponse = record(value);
  return {
    model: MODEL,
    ...parseGeminiUrlContextResponse(rawResponse),
    elapsedMs: Date.now() - startedAt,
    requestId: response.headers.get("x-request-id"),
    rawResponse,
  };
}

export function geminiUrlContextCostUsd(usage: Usage): number {
  return (usage.inputTokens * 0.3 + usage.outputTokens * 2.5) / 1_000_000;
}
