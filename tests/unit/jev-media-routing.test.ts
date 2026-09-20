import { describe, expect, it } from "vitest";
import {
  MEDIA_ROUTING_FIXTURES,
  type MediaRoutingFixture,
} from "../../poc/jev-recipe-gate/media-fixtures.js";
import {
  evaluateMediaRouting,
  routeForFixture,
  youtubeSufficiency,
  type JevMediaObservation,
} from "../../poc/jev-recipe-gate/media-routing.js";

function fixture(id: string): MediaRoutingFixture {
  const found = MEDIA_ROUTING_FIXTURES.find((item) => item.id === id);
  if (!found) throw new Error(`fixture not found: ${id}`);
  return found;
}

function observations(
  fixtureId: string,
  probabilities: number[],
  choices?: Array<"recipe" | "non_recipe">,
): JevMediaObservation[] {
  return probabilities.map((recipeProbability, index) => ({
    fixtureId,
    repetition: index + 1,
    recipeProbability,
    nonRecipeProbability: 1 - recipeProbability,
    choice:
      choices?.[index] ?? (recipeProbability >= 0.5 ? "recipe" : "non_recipe"),
  }));
}

describe("Jev media routing fixtures", () => {
  it("keeps fixture IDs unique and limits the default Jev run to 25 non-empty cases", () => {
    const ids = MEDIA_ROUTING_FIXTURES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MEDIA_ROUTING_FIXTURES).toHaveLength(28);
    expect(
      MEDIA_ROUTING_FIXTURES.filter(({ input }) => input !== null),
    ).toHaveLength(25);
  });

  it("separates semantic recipe classification from text sufficiency", () => {
    expect(fixture("instagram-recipe-title-only")).toMatchObject({
      expectedKind: "recipe",
      expectedRoute: "media",
    });
    expect(fixture("tiktok-photo-hashtag-only")).toMatchObject({
      expectedKind: "recipe",
      expectedRoute: "media",
    });
    expect(fixture("youtube-ingredients-only")).toMatchObject({
      expectedKind: "recipe",
      expectedRoute: "gemini",
    });
  });

  it("reuses the existing YouTube sufficiency decision before applying Jev probability", () => {
    const complete = fixture("youtube-clear-recipe-ja");
    const incomplete = fixture("youtube-ingredients-only");
    const roundup = fixture("youtube-multi-recipe-roundup");
    if (
      complete.platform !== "youtube" ||
      incomplete.platform !== "youtube" ||
      roundup.platform !== "youtube"
    ) {
      throw new Error("unexpected fixture platform");
    }

    expect(youtubeSufficiency(complete)).toEqual({
      sufficient: true,
      reason: "ingredients_and_steps",
    });
    expect(youtubeSufficiency(incomplete)).toEqual({
      sufficient: false,
      reason: "steps_missing",
    });
    expect(youtubeSufficiency(roundup)).toEqual({
      sufficient: true,
      reason: "ingredients_and_steps",
    });

    expect(routeForFixture(complete, 0.99, 0.95)).toBe("zai");
    expect(routeForFixture(complete, 0.7, 0.95)).toBe("gemini");
    expect(routeForFixture(incomplete, 1, 0.95)).toBe("gemini");
    expect(routeForFixture(roundup, 0.1, 0.95)).toBe("gemini");
  });

  it("routes Instagram and TikTok to text solely when a non-empty input clears the tested recipe threshold", () => {
    const complete = fixture("instagram-complete-caption-ja");
    const incompleteRecipe = fixture("instagram-recipe-title-only");
    const noText = fixture("tiktok-no-text");

    expect(routeForFixture(complete, 0.97, 0.95)).toBe("text");
    expect(routeForFixture(complete, 0.94, 0.95)).toBe("media");

    // This is intentionally unsafe under the proposed policy: Jev can
    // correctly classify a title-only post as recipe while the caption is
    // still too incomplete for text-only extraction.
    expect(routeForFixture(incompleteRecipe, 0.99, 0.95)).toBe("text");
    expect(incompleteRecipe.expectedRoute).toBe("media");

    expect(routeForFixture(noText, null, 0.95)).toBe("media");
  });

  it("selects a fixture-safe recipe threshold only when fallback-required cases never take the fast route", () => {
    const complete = fixture("instagram-complete-caption-ja");
    const incomplete = fixture("instagram-recipe-title-only");
    const selected = [complete, incomplete];
    const runs = [
      ...observations(complete.id, [0.99, 0.99, 0.98]),
      ...observations(incomplete.id, [0.96, 0.95, 0.96]),
    ];

    const result = evaluateMediaRouting(selected, runs, 3, [0.95, 0.97]);

    expect(result.thresholds[0]?.instagram.unsafeFastRouteCaseIds).toEqual([
      "instagram-recipe-title-only",
    ]);
    expect(result.thresholds[1]?.instagram.unsafeFastRouteCaseIds).toEqual([]);
    expect(result.thresholds[1]?.instagram.consistentFastRouteCaseIds).toEqual([
      "instagram-complete-caption-ja",
    ]);
    expect(result.candidateThresholdByPlatform.instagram).toBe(0.97);
    expect(result.candidateRecipeThreshold).toBe(0.97);
  });

  it("reports normal Jev choice correctness and stability independently from routing", () => {
    const recipe = fixture("ai-chat-single-recipe");
    const nonRecipe = fixture("ai-chat-cooking-tips");
    const selected = [recipe, nonRecipe];
    const runs = [
      ...observations(recipe.id, [0.99, 0.98, 0.97]),
      ...observations(
        nonRecipe.id,
        [0.1, 0.9, 0.1],
        ["non_recipe", "recipe", "non_recipe"],
      ),
    ];

    const result = evaluateMediaRouting(selected, runs, 3, [0.95]);

    expect(result.classification.runCount).toBe(6);
    expect(result.classification.correctRunCount).toBe(5);
    expect(result.classification.accuracy).toBeCloseTo(5 / 6);
    expect(result.classification.incorrectCaseIds).toEqual([
      "ai-chat-cooking-tips",
    ]);
    expect(result.classification.unstableChoiceCaseIds).toEqual([
      "ai-chat-cooking-tips",
    ]);
  });
});
