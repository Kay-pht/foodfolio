import type { ProviderName, ProviderResponse, Usage } from "./types.js";

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 4_000;

export const PROVIDERS: Record<
  ProviderName,
  {
    model: string;
    envKey: string;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    pricingNote: string;
  }
> = {
  gemini: {
    model: "gemini-3.5-flash-lite",
    envKey: "GEMINI_API_KEY",
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
    pricingNote: "Standard paid tier",
  },
  openai: {
    model: "gpt-5.6-luna",
    envKey: "OPENAI_API_KEY",
    inputUsdPerMillion: 0.2,
    outputUsdPerMillion: 1.2,
    pricingNote: "Promotional model-page price on 2026-08-27",
  },
  zai: {
    model: "glm-5.3-flash",
    envKey: "ZAI_API_KEY",
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.25,
    pricingNote: "50% promotion through 2026-09-09 24:00 UTC+8",
  },
  deepseek: {
    model: "deepseek-v4-flash",
    envKey: "DEEPSEEK_API_KEY",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
    pricingNote:
      "Conservative cap conversion: official CNY rates treated as USD one-for-one",
  },
};

export function resolveProviders(value: string | undefined): ProviderName[] {
  if (!value?.trim()) return Object.keys(PROVIDERS) as ProviderName[];
  const requested = [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const invalid = requested.filter((item) => !(item in PROVIDERS));
  if (invalid.length > 0) {
    throw new Error(`unknown providers: ${invalid.join(", ")}`);
  }
  return requested as ProviderName[];
}

const SYSTEM_PROMPT = `You extract recipe facts only from supplied source text.
Return JSON matching the schema exactly.
Return one recipe data instance. Never return, copy, modify, or annotate the JSON Schema itself.
Do not infer missing facts, except that genre must be classified from the supplied recipe content. Use null or an empty array when the source omits any other fact.
Preserve ingredient names, amounts, yield wording, and important cooking operations faithfully.
Genre must be one allowed Japanese enum value.`;

function outputTextFromResponsesApi(value: Record<string, unknown>): string {
  if (typeof value.output_text === "string") return value.output_text;
  const output = Array.isArray(value.output) ? value.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as Record<string, unknown>).content;
      return Array.isArray(content) ? content : [];
    })
    .map((item) =>
      item && typeof item === "object"
        ? (item as Record<string, unknown>).text
        : null,
    )
    .filter((item): item is string => typeof item === "string")
    .join("");
}

function numberAt(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ value: Record<string, unknown>; requestId: string | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
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
    const error =
      value && typeof value === "object" ? JSON.stringify(value) : raw;
    throw new Error(`${response.status} API error: ${error.slice(0, 600)}`);
  }
  if (!value || typeof value !== "object")
    throw new Error("empty API response");
  return {
    value: value as Record<string, unknown>,
    requestId:
      response.headers.get("x-request-id") ??
      response.headers.get("request-id") ??
      null,
  };
}

function responsesUsage(value: Record<string, unknown>): Usage {
  const usage =
    value.usage && typeof value.usage === "object"
      ? (value.usage as Record<string, unknown>)
      : {};
  const details =
    usage.input_tokens_details && typeof usage.input_tokens_details === "object"
      ? (usage.input_tokens_details as Record<string, unknown>)
      : {};
  return {
    inputTokens: numberAt(usage.input_tokens),
    outputTokens: numberAt(usage.output_tokens),
    cachedInputTokens: numberAt(details.cached_tokens),
  };
}

export async function callProvider(
  provider: ProviderName,
  sourceText: string,
  schema: Record<string, unknown>,
): Promise<ProviderResponse> {
  const config = PROVIDERS[provider];
  const apiKey = process.env[config.envKey];
  if (!apiKey) throw new Error(`${config.envKey} is not set`);
  const startedAt = Date.now();
  const input = `SOURCE TEXT\n${sourceText}`;

  if (provider === "gemini") {
    const { value, requestId } = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
      { "x-goog-api-key": apiKey },
      {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: input }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      },
    );
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    const candidate =
      candidates[0] && typeof candidates[0] === "object"
        ? (candidates[0] as Record<string, unknown>)
        : {};
    const content =
      candidate.content && typeof candidate.content === "object"
        ? (candidate.content as Record<string, unknown>)
        : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const outputText = parts
      .map((part) =>
        part && typeof part === "object"
          ? (part as Record<string, unknown>).text
          : null,
      )
      .filter((part): part is string => typeof part === "string")
      .join("");
    const usage =
      value.usageMetadata && typeof value.usageMetadata === "object"
        ? (value.usageMetadata as Record<string, unknown>)
        : {};
    return {
      provider,
      model: config.model,
      outputText,
      usage: {
        inputTokens: numberAt(usage.promptTokenCount),
        outputTokens:
          numberAt(usage.candidatesTokenCount) +
          numberAt(usage.thoughtsTokenCount),
        cachedInputTokens: numberAt(usage.cachedContentTokenCount),
      },
      elapsedMs: Date.now() - startedAt,
      requestId,
      rawResponse: value,
    };
  }

  if (provider === "zai") {
    const { value, requestId } = await postJson(
      "https://api.z.ai/api/paas/v4/chat/completions",
      { authorization: `Bearer ${apiKey}` },
      {
        model: config.model,
        messages: [
          {
            role: "system",
            content: `${SYSTEM_PROMPT}\nJSON SCHEMA\n${JSON.stringify(schema)}`,
          },
          { role: "user", content: input },
        ],
        response_format: { type: "json_object" },
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
      },
    );
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const choice =
      choices[0] && typeof choices[0] === "object"
        ? (choices[0] as Record<string, unknown>)
        : {};
    const message =
      choice.message && typeof choice.message === "object"
        ? (choice.message as Record<string, unknown>)
        : {};
    const usage =
      value.usage && typeof value.usage === "object"
        ? (value.usage as Record<string, unknown>)
        : {};
    return {
      provider,
      model: config.model,
      outputText: typeof message.content === "string" ? message.content : "",
      usage: {
        inputTokens: numberAt(usage.prompt_tokens),
        outputTokens: numberAt(usage.completion_tokens),
        cachedInputTokens: numberAt(
          usage.prompt_tokens_details &&
            typeof usage.prompt_tokens_details === "object"
            ? (usage.prompt_tokens_details as Record<string, unknown>)
                .cached_tokens
            : 0,
        ),
      },
      elapsedMs: Date.now() - startedAt,
      requestId:
        requestId ??
        (typeof value.request_id === "string" ? value.request_id : null),
      rawResponse: value,
    };
  }

  const baseUrl =
    provider === "openai"
      ? "https://api.openai.com/v1/responses"
      : "https://api.deepseek.com/responses";
  const body: Record<string, unknown> = {
    model: config.model,
    instructions: SYSTEM_PROMPT,
    input,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "foodfolio_recipe",
        strict: true,
        schema,
      },
    },
  };
  if (provider === "openai") body.reasoning = { effort: "none" };
  const { value, requestId } = await postJson(
    baseUrl,
    { authorization: `Bearer ${apiKey}` },
    body,
  );
  return {
    provider,
    model: config.model,
    outputText: outputTextFromResponsesApi(value),
    usage: responsesUsage(value),
    elapsedMs: Date.now() - startedAt,
    requestId,
    rawResponse: value,
  };
}

export function costUsd(provider: ProviderName, usage: Usage): number {
  const config = PROVIDERS[provider];
  const uncachedInput = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens,
  );
  return (
    (uncachedInput * config.inputUsdPerMillion +
      usage.outputTokens * config.outputUsdPerMillion) /
    1_000_000
  );
}

export function conservativePlannedCostUsd(
  provider: ProviderName,
  sourceCharacters: number,
): number {
  const estimatedInputTokens = Math.ceil(sourceCharacters / 2) + 1_500;
  return costUsd(provider, {
    inputTokens: estimatedInputTokens,
    outputTokens: MAX_OUTPUT_TOKENS,
    cachedInputTokens: 0,
  });
}
