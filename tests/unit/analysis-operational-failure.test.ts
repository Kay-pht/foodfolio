import { describe, expect, it } from "vitest";

import { describeAnalysisFailure } from "../../src/application/analysis/operational-failure.js";

describe("describeAnalysisFailure", () => {
  it("returns actionable, non-sensitive guidance for source fetch failures", () => {
    expect(
      describeAnalysisFailure({
        errorCode: "SOURCE_FETCH_FAILED",
        provider: undefined,
        attempt: 1,
      }),
    ).toEqual({
      target: "レシピ解析",
      provider: "not_applicable",
      summary:
        "取得元のページを取得できませんでした。HTTP応答・リダイレクト等の詳細理由は未確認です。",
      impact:
        "対象のレシピは解析完了にならず、アプリでは解析失敗として表示されます。",
      retryPolicy: "final_failure",
      nextAction:
        "取得元URLへの到達可否とWorkerログのHTTP応答・リダイレクトを確認してください。",
    });
  });

  it("uses safe generic guidance for unknown classifications", () => {
    expect(
      describeAnalysisFailure({
        errorCode: "FUTURE_ERROR",
        provider: "zai",
        attempt: 3,
      }),
    ).toEqual({
      target: "レシピ解析",
      provider: "zai",
      summary: "レシピ解析が最終的に失敗しました。",
      impact:
        "対象のレシピは解析完了にならず、アプリでは解析失敗として表示されます。",
      retryPolicy: "final_failure",
      nextAction:
        "WorkerログのFUTURE_ERRORと同時刻のログを確認し、再発状況と影響範囲を調査してください。",
    });
  });
});

// AAF-1 / AAF-2: observed diagnostics must explain the failure without raw text.
describe("actionable failure diagnostics", () => {
  it("describes the reported 4000-token truncation", () => {
    const result = describeAnalysisFailure({
      errorCode: "AI_INVALID_JSON",
      provider: "zai",
      attempt: 3,
      diagnostics: {
        aiFailureStage: "content_invalid_json",
        model: "glm-5.3-flash",
        latencyMs: 87688,
        providerFinishReason: "length",
        outputTokens: 4000,
        maxOutputTokens: 4000,
        responseContentChars: 0,
      },
    });
    expect(result.summary).toContain("出力上限4000トークン");
    expect(result.summary).toContain("打ち切られました");
    expect(result.summary).toContain("出力4000トークン");
    expect(result.nextAction).toContain("出力上限");
    expect(result.nextAction).not.toContain("一時障害");
  });

  it.each([
    ["request_network", "通信"],
    ["request_timeout", "時間"],
    ["http_rate_limited", "制限"],
    ["http_provider_error", "サーバー"],
    ["http_rejected", "拒否"],
    ["response_envelope_invalid_json", "応答全体"],
    ["content_missing", "本文がありません"],
    ["content_invalid_json", "JSON"],
    ["schema_invalid", "形式"],
  ] as const)("explains stage %s", (aiFailureStage, phrase) => {
    expect(
      describeAnalysisFailure({
        errorCode: "AI_TIMEOUT",
        provider: "zai",
        attempt: 3,
        diagnostics: {
          aiFailureStage,
          model: "private-model",
          latencyMs: 1,
          providerHttpStatus: 403,
        },
      }).summary,
    ).toContain(phrase);
  });

  it("does not invent token counts when absent or invalid", () => {
    for (const outputTokens of [undefined, NaN, Infinity, -1]) {
      const result = describeAnalysisFailure({
        errorCode: "AI_INVALID_JSON",
        provider: "zai",
        attempt: 3,
        diagnostics: {
          aiFailureStage: "content_missing",
          model: "secret",
          latencyMs: 1,
          providerFinishReason: "length",
          outputTokens,
        },
      });
      expect(result.summary).toContain("打ち切られました");
      expect(result.summary).not.toMatch(/4000|NaN|Infinity|-1|secret/);
    }
  });

  it.each([
    ["AI_RATE_LIMITED", "制限"],
    ["AI_SCHEMA_INVALID", "形式"],
    ["SOURCE_ACCESS_DENIED", "アクセス"],
    ["SOURCE_CONTENT_UNAVAILABLE", "内容"],
    ["INSTAGRAM_MEDIA_METADATA_FAILED", "メタデータ"],
    ["TIKTOK_VIDEO_DOWNLOAD_FAILED", "ダウンロード"],
    ["YOUTUBE_GEMINI_SAFETY_BLOCKED", "安全"],
    ["YOUTUBE_GEMINI_HTTP_403", "HTTP 403"],
    ["SHARED_CONVERSATION_FORMAT_CHANGED", "形式"],
  ])("explains known code %s", (errorCode, phrase) => {
    expect(
      describeAnalysisFailure({ errorCode, provider: undefined, attempt: 3 })
        .summary,
    ).toContain(phrase);
  });
});

it("renders every available source diagnostic as controlled Slack detail", () => {
  const result = describeAnalysisFailure({
    errorCode: "SOURCE_FETCH_FAILED",
    provider: undefined,
    attempt: 3,
    diagnostics: {
      sourceOperation: "tiktok_oembed",
      sourceFailureStage: "response_body",
      sourceFailureClass: "timeout",
      sourceHttpStatus: 503,
      sourceRedirectCount: 2,
    },
  });

  expect(result.diagnosticDetail).toBe(
    "取得処理: TikTok oEmbed取得 / 取得段階: レスポンス本文 / 取得原因: タイムアウト / HTTP: 503 / redirect: 2回",
  );
});

it("renders every available media diagnostic as controlled Slack detail", () => {
  const result = describeAnalysisFailure({
    errorCode: "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
    provider: undefined,
    attempt: 3,
    diagnostics: {
      mediaFailureStage: "local_prepare",
      mediaFailureClass: "filesystem",
      mediaHttpStatus: 503,
      mediaIndex: 2,
      mediaKind: "image",
      mediaAttempt: 1,
      mediaMaxAttempts: 2,
    },
  });

  expect(result.diagnosticDetail).toBe(
    "メディア段階: ローカル作業領域準備 / メディア原因: ファイルシステム / メディアHTTP: 503 / 投稿内項目: 2 / 種別: 画像 / 内部試行: 1/2",
  );
});

it("keeps Slack diagnostic detail free of arbitrary provider text", () => {
  const result = describeAnalysisFailure({
    errorCode: "AI_INVALID_JSON",
    provider: "zai",
    attempt: 3,
    diagnostics: {
      aiFailureStage: "content_invalid_json",
      providerRequestId: "secret-request",
      providerFinishReason: "secret-finish",
      model: "secret-model",
      schemaErrorPaths: ["secret-path"],
    },
  });

  expect(result.diagnosticDetail).toBe("追加診断情報なし");
  expect(JSON.stringify(result)).not.toContain("secret-");
});

// Legacy Gemini and AI codes can combine network and timeout failures.
it.each(["AI_TIMEOUT", "YOUTUBE_GEMINI_TIMEOUT"])(
  "does not assert timeout without diagnostics for %s",
  (errorCode) => {
    const result = describeAnalysisFailure({
      errorCode,
      provider: undefined,
      attempt: 3,
    });
    expect(result.summary).toContain("通信に失敗したか");
    expect(result.nextAction).toContain("区別は未確認");
  },
);

it("does not project provider text into Slack-facing descriptions", () => {
  const result = describeAnalysisFailure({
    errorCode: "AI_INVALID_JSON",
    provider: "zai",
    attempt: 3,
    diagnostics: {
      aiFailureStage: "content_invalid_json",
      model: "secret-model",
      latencyMs: 1,
      providerRequestId: "secret-id",
      providerFinishReason: "secret-reason",
      inputTokens: 28684,
      schemaErrorPaths: ["secret-path"],
      schemaErrorKeywords: ["secret-keyword"],
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/secret-|28684/);
  expect(result.summary).not.toContain("打ち切り");
});

it("does not present HTTP rejection as a provider outage", () => {
  const result = describeAnalysisFailure({
    errorCode: "AI_PROVIDER_ERROR",
    provider: "zai",
    attempt: 3,
    diagnostics: {
      aiFailureStage: "http_rejected",
      model: "glm",
      latencyMs: 1,
      providerHttpStatus: 403,
    },
  });
  expect(result.summary).toContain("HTTP 403");
  expect(result.nextAction).not.toMatch(/一時障害|復旧後/);
});
