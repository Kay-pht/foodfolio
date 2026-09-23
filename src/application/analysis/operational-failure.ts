export interface AnalysisFailureDescriptionInput {
  errorCode: string;
  provider: "zai" | "gemini" | undefined;
  attempt: number;
}

export interface AnalysisFailureDescription {
  target: string;
  provider: "zai" | "gemini" | "not_applicable";
  summary: string;
  impact: string;
  retryPolicy: "final_failure";
  nextAction: string;
}

export function describeAnalysisFailure(
  input: AnalysisFailureDescriptionInput,
): AnalysisFailureDescription {
  const common: Pick<
    AnalysisFailureDescription,
    "target" | "provider" | "impact" | "retryPolicy"
  > = {
    target: "レシピ解析",
    provider: input.provider ?? "not_applicable",
    impact:
      "対象のレシピは解析完了にならず、アプリでは解析失敗として表示されます。",
    retryPolicy: "final_failure" as const,
  };

  if (
    input.errorCode.startsWith("SOURCE_") ||
    input.errorCode.startsWith("SHARED_CONVERSATION_")
  ) {
    return {
      ...common,
      summary: "取得元からレシピ解析に必要な内容を取得できませんでした。",
      nextAction: `取得元URLへの到達可否とWorkerログの${input.errorCode}を確認してください。取得元の一時障害なら、復旧後に利用者へ再登録を案内してください。`,
    };
  }

  if (
    input.errorCode.startsWith("AI_") ||
    input.errorCode.startsWith("YOUTUBE_GEMINI_")
  ) {
    return {
      ...common,
      summary: "AIによるレシピ解析が最終試行まで成功しませんでした。",
      nextAction: `Workerログの${input.errorCode}とAI提供元の稼働状況・制限を確認してください。提供元の一時障害なら、復旧後に利用者へ再登録を案内してください。`,
    };
  }

  if (
    input.errorCode.startsWith("TIKTOK_") ||
    input.errorCode.startsWith("INSTAGRAM_")
  ) {
    return {
      ...common,
      summary: "SNSメディアからのレシピ解析が最終的に失敗しました。",
      nextAction: `Workerログの${input.errorCode}を確認し、メディア取得・変換・解析のどの段階で失敗したか調査してください。`,
    };
  }

  return {
    ...common,
    summary: "レシピ解析が最終的に失敗しました。",
    nextAction: `Workerログの${input.errorCode}と同時刻のログを確認し、再発状況と影響範囲を調査してください。`,
  };
}
