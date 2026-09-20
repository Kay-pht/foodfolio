import { describe, expect, it } from "vitest";
import type { SourceContent } from "../../src/application/analysis/types.js";
import {
  evaluationFixtureForLiveCase,
  parseLiveMediaCorpus,
} from "../../poc/jev-recipe-gate/media-live-corpus.js";
import {
  routeForFixture,
  youtubeSufficiency,
} from "../../poc/jev-recipe-gate/media-routing.js";

describe("Jev live media corpus", () => {
  it("derives supported sources, normalizes URLs, and enforces route labels", () => {
    const corpus = parseLiveMediaCorpus({
      schemaVersion: 1,
      cases: [
        {
          id: "yt-1",
          url: "https://youtu.be/abc123DEF45?utm_source=test",
          expectedKind: "recipe",
          expectedRoute: "zai",
          rationale: "description alone is manually confirmed sufficient",
        },
        {
          id: "chat-1",
          url: "https://chatgpt.com/share/example-share-id",
          expectedKind: "recipe",
          expectedRoute: null,
          rationale: "one public shared recipe conversation",
        },
      ],
    });

    expect(corpus.cases[0]).toMatchObject({
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abc123DEF45",
    });
    expect(corpus.cases[1]?.source).toBe("chatgpt");

    expect(() =>
      parseLiveMediaCorpus({
        schemaVersion: 1,
        cases: [
          {
            id: "bad-route",
            url: "https://www.instagram.com/reel/example/",
            expectedKind: "recipe",
            expectedRoute: "zai",
            rationale: "invalid route for this source",
          },
        ],
      }),
    ).toThrow("Instagram/TikTok cases require expectedRoute text or media");
  });

  it("rejects duplicate normalized URLs so one post cannot inflate evidence", () => {
    expect(() =>
      parseLiveMediaCorpus({
        schemaVersion: 1,
        cases: [
          {
            id: "yt-a",
            url: "https://youtu.be/abc123DEF45",
            expectedKind: "recipe",
            expectedRoute: "zai",
            rationale: "first spelling",
          },
          {
            id: "yt-b",
            url: "https://www.youtube.com/watch?v=abc123DEF45&utm_source=x",
            expectedKind: "recipe",
            expectedRoute: "zai",
            rationale: "same video",
          },
        ],
      }),
    ).toThrow("duplicate normalized URL");
  });

  it("stores a redacted evaluation fixture while preserving YouTube sufficiency", () => {
    const item = parseLiveMediaCorpus({
      schemaVersion: 1,
      cases: [
        {
          id: "yt-live",
          url: "https://www.youtube.com/watch?v=abc123DEF45",
          expectedKind: "recipe",
          expectedRoute: "zai",
          rationale: "complete recipe description",
        },
      ],
    }).cases[0]!;

    const source: SourceContent = {
      sourceType: "youtube",
      resolvedUrl: item.url,
      imageUrl: null,
      textForAi:
        "TITLE\nSecret title\n\nDESCRIPTION\n材料\n豚肉 200g\n玉ねぎ 1個\n作り方\n1. 玉ねぎを切る\n2. 豚肉を炒める",
      youtubeTitle: "Secret title",
      youtubeDescription:
        "材料\n豚肉 200g\n玉ねぎ 1個\n作り方\n1. 玉ねぎを切る\n2. 豚肉を炒める",
    };

    const fixture = evaluationFixtureForLiveCase(item, source);
    expect(fixture.platform).toBe("youtube");
    if (fixture.platform !== "youtube")
      throw new Error("unexpected fixture platform");

    expect(fixture.input).toBe("[redacted live source text]");
    expect(fixture.title).toBe("");
    expect(fixture.description).toBe("");
    expect(youtubeSufficiency(fixture)).toEqual({
      sufficient: true,
      reason: "ingredients_and_steps",
    });
    expect(routeForFixture(fixture, 0.99, 0.99)).toBe("zai");
    expect(JSON.stringify(fixture)).not.toContain("Secret title");
    expect(JSON.stringify(fixture)).not.toContain("豚肉");
  });

  it("maps ChatGPT and Gemini live URLs to AI-chat classification fixtures", () => {
    const item = parseLiveMediaCorpus({
      schemaVersion: 1,
      cases: [
        {
          id: "gemini-live",
          url: "https://gemini.google.com/share/example",
          expectedKind: "non-recipe",
          expectedRoute: null,
          rationale: "meal-planning conversation rather than one recipe",
        },
      ],
    }).cases[0]!;

    const source: SourceContent = {
      sourceType: "gemini",
      resolvedUrl: item.url,
      imageUrl: null,
      textForAi: "MESSAGE 1 ROLE=user\n一週間の献立を考えて",
    };
    expect(evaluationFixtureForLiveCase(item, source)).toMatchObject({
      platform: "ai-chat",
      channel: "gemini",
      expectedKind: "non-recipe",
      expectedRoute: null,
      input: "[redacted live source text]",
      provenance: "live-url",
    });
  });
});
