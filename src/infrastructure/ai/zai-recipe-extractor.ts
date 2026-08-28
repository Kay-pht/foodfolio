import { Ajv2020 } from "ajv/dist/2020.js";
import recipeSchema from "../../../schemas/extracted-recipe.schema.json" with { type: "json" };
import {
  AnalysisError,
  type ExtractedRecipe,
  type RecipeExtractor,
  type SourceContent,
} from "../../application/analysis/types.js";

const SYSTEM_PROMPT = `You extract recipe facts only from supplied source text.
Return JSON matching the schema exactly. Return one recipe data instance.
Never return, copy, modify, or annotate the JSON Schema itself.
Do not infer missing facts, except that genre must be classified from the supplied recipe content.
Use null or an empty array when the source omits any other fact.
Preserve ingredient names, amounts, yield wording, and important cooking operations faithfully.
Genre must be one allowed Japanese enum value.`;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile<ExtractedRecipe>(recipeSchema);

export class ZaiRecipeExtractor implements RecipeExtractor {
  constructor(
    private readonly apiKey: string,
    private readonly model = "glm-5.3-flash",
  ) {}
  async extract(input: SourceContent) {
    if (!input.textForAi)
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "Source text is empty",
      );
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: `${SYSTEM_PROMPT}\nJSON SCHEMA\n${JSON.stringify(recipeSchema)}`,
            },
            { role: "user", content: `SOURCE TEXT\n${input.textForAi}` },
          ],
          response_format: { type: "json_object" },
          max_tokens: 4000,
          stream: false,
        }),
      });
    } catch {
      throw new AnalysisError("AI_TIMEOUT", true, "AI request timed out");
    }
    if (response.status === 429)
      throw new AnalysisError("AI_RATE_LIMITED", true, "AI rate limited");
    if (response.status >= 500)
      throw new AnalysisError(
        "AI_PROVIDER_ERROR",
        true,
        "AI provider unavailable",
      );
    if (!response.ok)
      throw new AnalysisError(
        "AI_PROVIDER_ERROR",
        false,
        "AI provider rejected request",
      );
    const value = (await response.json()) as Record<string, unknown>;
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const choice = choices[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.content !== "string")
      throw new AnalysisError(
        "AI_INVALID_JSON",
        true,
        "AI response content is missing",
      );
    let recipe: unknown;
    try {
      recipe = JSON.parse(message.content);
    } catch {
      throw new AnalysisError(
        "AI_INVALID_JSON",
        true,
        "AI response is not JSON",
      );
    }
    if (!validate(recipe))
      throw new AnalysisError(
        "AI_SCHEMA_INVALID",
        true,
        "AI response did not match schema",
      );
    const usage = value.usage as Record<string, unknown> | undefined;
    return {
      recipe,
      providerRequestId:
        response.headers.get("x-request-id") ??
        (typeof value.request_id === "string" ? value.request_id : null),
      inputTokens:
        typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      outputTokens:
        typeof usage?.completion_tokens === "number"
          ? usage.completion_tokens
          : 0,
      latencyMs: Date.now() - startedAt,
    };
  }
}
