import { parseAndEvaluate } from "../ai-extraction/evaluate.js";
import { callProvider } from "../ai-extraction/providers.js";
import type {
  ExpectedFixture,
  ProviderName,
  ProviderResponse,
} from "../ai-extraction/types.js";
import recipeSchema from "../shared/recipe-schema.json" with { type: "json" };
import { extractUrl } from "../url-extraction/extract.js";
import type { UrlCase } from "../url-extraction/types.js";

export type ProviderCall = (
  provider: ProviderName,
  sourceText: string,
  schema: Record<string, unknown>,
) => Promise<ProviderResponse>;

export async function runPipeline(
  testCase: UrlCase,
  expected: ExpectedFixture,
  provider: ProviderName,
  providerCall: ProviderCall = callProvider,
) {
  const extraction = await extractUrl(testCase);
  if (!extraction.aiInput.usable) {
    throw new Error(`URL extraction failed: ${extraction.aiInput.reason}`);
  }
  const response = await providerCall(
    provider,
    extraction.aiInput.text,
    recipeSchema as Record<string, unknown>,
  );
  const evaluated = parseAndEvaluate(response.outputText, expected.recipe);
  return { extraction, response, ...evaluated };
}
