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
      summary: "取得元からレシピ解析に必要な内容を取得できませんでした。",
      impact:
        "対象のレシピは解析完了にならず、アプリでは解析失敗として表示されます。",
      retryPolicy: "final_failure",
      nextAction:
        "取得元URLへの到達可否とWorkerログのSOURCE_FETCH_FAILEDを確認してください。取得元の一時障害なら、復旧後に利用者へ再登録を案内してください。",
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
