import type { AiFailureStage, AnalysisFailureDiagnostics } from "./types.js";

export interface AnalysisFailureDescriptionInput {
  errorCode: string;
  provider: "zai" | "gemini" | undefined;
  attempt: number;
  diagnostics?: AnalysisFailureDiagnostics | undefined;
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

  const detail = describeObservedFailure(input);
  if (detail) return { ...common, ...detail };

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

interface FailureDetail {
  summary: string;
  nextAction: string;
}

function tokenCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function describeObservedFailure(
  input: AnalysisFailureDescriptionInput,
): FailureDetail | undefined {
  const diagnostics = input.diagnostics;
  if (
    diagnostics?.providerFinishReason === "length" ||
    input.errorCode === "YOUTUBE_GEMINI_OUTPUT_TRUNCATED"
  ) {
    const limit = tokenCount(diagnostics?.maxOutputTokens);
    const output = tokenCount(diagnostics?.outputTokens);
    return {
      summary: `AIの生成が${limit !== undefined ? `出力上限${limit}トークン` : "出力トークン上限"}に達して打ち切られました${output !== undefined ? `（出力${output}トークン）` : ""}。解析に必要な結果を取得できませんでした。`,
      nextAction:
        "AIリクエストの出力上限と入力の長さを確認し、上限・出力形式・入力構成の見直しを検証してください。",
    };
  }
  const stage = diagnostics?.aiFailureStage;
  const status = diagnostics?.providerHttpStatus;
  if (stage === "http_rejected") {
    const http =
      status !== undefined &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
        ? `（HTTP ${status}）`
        : "";
    return {
      summary: `AI提供元がリクエストを拒否しました${http}。`,
      nextAction:
        "認証・権限、指定モデル、リクエスト形式と提供元の制限を確認してください。",
    };
  }
  const stageDetail = stage ? STAGE_DETAILS[stage] : undefined;
  if (stageDetail) return stageDetail;
  const codeDetail = CODE_DETAILS[input.errorCode];
  if (codeDetail) return codeDetail;
  const httpMatch = /^YOUTUBE_GEMINI_HTTP_([45]\d{2})$/.exec(input.errorCode);
  if (httpMatch) {
    const http = Number(httpMatch[1]);
    if (http === 429) return STAGE_DETAILS.http_rate_limited;
    if (http >= 500)
      return {
        ...STAGE_DETAILS.http_provider_error!,
        summary: `AI提供元でサーバーエラーが返されました（HTTP ${http}）。`,
      };
    return {
      summary: `AI提供元がリクエストを拒否しました（HTTP ${http}）。`,
      nextAction:
        "認証・権限、指定モデル、リクエスト形式と提供元の制限を確認してください。",
    };
  }
  return undefined;
}

const STAGE_DETAILS: Partial<
  Record<AiFailureStage, FailureDetail>
> = {
  request_network: {
    summary: "AI提供元への通信に失敗しました。",
    nextAction:
      "WorkerからAI提供元への接続、DNS、ネットワークと提供元の稼働状況を確認してください。",
  },
  request_timeout: {
    summary: "AI提供元との通信が制限時間内に完了しませんでした。",
    nextAction:
      "AI提供元の応答時間と入力サイズを確認し、タイムアウト設定や入力構成の見直しを検証してください。",
  },
  http_rate_limited: {
    summary: "AI提供元のリクエスト制限により拒否されました（HTTP 429）。",
    nextAction:
      "AI提供元の利用枠・同時実行数・リクエスト頻度を確認してください。制限解除後に再登録を案内してください。",
  },
  http_provider_error: {
    summary: "AI提供元でサーバーエラーが返されました（HTTP 5xx）。",
    nextAction:
      "AI提供元の稼働状況と再発状況を確認し、復旧後に再登録を案内してください。",
  },
  response_envelope_invalid_json: {
    summary: "AI提供元の応答全体をJSONとして読み取れませんでした。",
    nextAction:
      "提供元のAPI応答形式と互換性を確認してください。応答本文はSlackやログに転載しないでください。",
  },
  content_missing: {
    summary: "AIの応答に解析結果の本文がありませんでした。",
    nextAction: "AI応答形式と生成終了理由を確認してください。",
  },
  content_invalid_json: {
    summary: "AIの解析結果をJSONとして読み取れませんでした。",
    nextAction:
      "AIのJSON出力設定・生成終了理由を確認し、出力形式の見直しを検証してください。",
  },
  schema_invalid: {
    summary:
      "AIの解析結果がレシピの必須項目・型などの形式に一致しませんでした。",
    nextAction: "schema検証の項目とAIに指定するレシピ形式を確認してください。",
  },
};

const CODE_DETAILS: Record<string, FailureDetail> = Object.create(
  null,
) as Record<string, FailureDetail>;
function defineDetails(
  codes: string[],
  summary: string,
  nextAction: string,
): void {
  for (const code of codes) CODE_DETAILS[code] = { summary, nextAction };
}
defineDetails(
  ["AI_TIMEOUT", "YOUTUBE_GEMINI_TIMEOUT"],
  "AI提供元への通信に失敗したか、制限時間内に完了しませんでした。",
  "WorkerからAI提供元への接続と応答時間を確認してください。診断情報がないため通信失敗と時間切れの区別は未確認です。",
);
defineDetails(
  ["AI_RATE_LIMITED"],
  STAGE_DETAILS.http_rate_limited!.summary,
  STAGE_DETAILS.http_rate_limited!.nextAction,
);
defineDetails(
  ["AI_PROVIDER_ERROR"],
  "AI提供元へのリクエストが失敗しました。HTTP詳細がなく、拒否理由は未確認です。",
  "WorkerログのHTTPステータスを確認し、認証・リクエスト内容・提供元の稼働状況を切り分けてください。",
);
defineDetails(
  ["AI_INVALID_JSON"],
  STAGE_DETAILS.content_invalid_json!.summary,
  STAGE_DETAILS.content_invalid_json!.nextAction,
);
defineDetails(
  ["YOUTUBE_GEMINI_INVALID_JSON"],
  "AIの応答をJSONとして読み取れませんでした。応答全体と解析結果のどちらの形式が原因かは未確認です。",
  "AI提供元のAPI応答形式とJSON出力設定を確認してください。",
);
defineDetails(
  ["AI_SCHEMA_INVALID", "YOUTUBE_GEMINI_SCHEMA_INVALID"],
  STAGE_DETAILS.schema_invalid!.summary,
  STAGE_DETAILS.schema_invalid!.nextAction,
);
defineDetails(
  ["AI_RECIPE_INCOMPLETE", "YOUTUBE_GEMINI_RECIPE_INCOMPLETE"],
  "AIの解析結果に材料・作り方が不足しています。",
  "元の内容に材料と作り方が含まれるか確認してください。",
);
defineDetails(
  ["AI_MEDIA_INPUT_INVALID"],
  "AIへ渡すメディア入力が要件を満たしませんでした。",
  "メディアの件数・形式・順序を確認してください。",
);
defineDetails(
  ["YOUTUBE_GEMINI_SAFETY_BLOCKED"],
  "AI提供元の安全性判定により生成が停止しました。",
  "元の内容と提供元の安全性ポリシーを確認してください。判定の詳細理由は未確認です。",
);
defineDetails(
  ["YOUTUBE_GEMINI_API_KEY_MISSING"],
  "YouTube解析用のAI APIキーが設定されていません。",
  "WorkerのGEMINI_API_KEY設定とSecret参照を確認してください。キーの値は共有しないでください。",
);
defineDetails(
  ["YOUTUBE_GEMINI_ENVELOPE_INVALID", "YOUTUBE_GEMINI_FINISH_REASON_INVALID"],
  "AIの応答構造または生成終了理由が想定する形式に一致しませんでした。",
  "AI提供元のAPI仕様と応答処理の互換性を確認してください。",
);
defineDetails(
  [
    "YOUTUBE_GEMINI_FALLBACK_DISABLED",
    "INSTAGRAM_MEDIA_FALLBACK_DISABLED",
    "TIKTOK_MEDIA_ANALYSIS_DISABLED",
  ],
  "必要なメディア解析機能が設定で無効になっています。",
  "対象のWorker機能フラグと有効化方針を確認してください。",
);
defineDetails(
  ["SOURCE_ACCESS_DENIED", "SHARED_CONVERSATION_ACCESS_DENIED"],
  "取得元へのアクセスが拒否されました。",
  "元のページの公開状態・アクセス権を確認してください。必要な制限の詳細は未確認です。",
);
defineDetails(
  ["SOURCE_UNSAFE_URL"],
  "取得元URLが安全性チェックで拒否されました。",
  "URLの形式と公開ホストを確認してください。安全性チェックは解除しないでください。",
);
defineDetails(
  ["SOURCE_FETCH_TIMEOUT"],
  "取得元との通信に失敗したか、制限時間内に取得できませんでした。",
  "取得元への接続と応答時間を確認してください。",
);
defineDetails(
  ["SOURCE_CONTENT_UNAVAILABLE"],
  "取得元から解析に必要な内容を利用できませんでした。サイズ超過や材料・作り方の不足など、詳細理由は未確認です。",
  "元の内容の取得可否・サイズと材料・作り方の有無を確認してください。",
);
defineDetails(
  ["SOURCE_FETCH_FAILED", "SHARED_CONVERSATION_FETCH_FAILED"],
  "取得元のページを取得できませんでした。HTTP応答・リダイレクト等の詳細理由は未確認です。",
  "取得元URLへの到達可否とWorkerログのHTTP応答・リダイレクトを確認してください。",
);
defineDetails(
  ["SHARED_CONVERSATION_FORMAT_CHANGED"],
  "共有会話のページ形式・公開URLが想定と一致せず、取得できませんでした。",
  "公開共有リンクとページ形式を確認し、取得処理の互換性を調査してください。",
);
defineDetails(
  [
    "SHARED_CONVERSATION_INVALID_URL",
    "INSTAGRAM_MEDIA_URL_INVALID",
    "INSTAGRAM_VIDEO_URL_INVALID",
    "TIKTOK_VIDEO_URL_INVALID",
  ],
  "解析対象の共有URL・メディアURLが想定する形式に一致しませんでした。",
  "対応サービスの公開URLか確認してください。",
);
defineDetails(
  ["INSTAGRAM_MEDIA_METADATA_FAILED", "INSTAGRAM_VIDEO_METADATA_FAILED"],
  "Instagramメディアのメタデータ取得に失敗しました。公開制限・削除・取得ツール等の詳細原因は未確認です。",
  "投稿の公開状態・閲覧可否とメディア取得ツールの対応状況を確認してください。",
);
defineDetails(
  ["INSTAGRAM_MEDIA_METADATA_INVALID"],
  "Instagramメディアのメタデータが想定する形式に一致しませんでした。",
  "メディア取得ツールの応答形式と解析処理の互換性を確認してください。",
);
defineDetails(
  [
    "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
    "INSTAGRAM_VIDEO_DOWNLOAD_FAILED",
    "TIKTOK_VIDEO_DOWNLOAD_FAILED",
    "TIKTOK_PHOTO_MEDIA_UNAVAILABLE",
  ],
  "SNSメディアのダウンロード・解析用の準備に失敗しました。詳細原因は未確認です。",
  "投稿の閲覧可否、メディア取得ツール、Workerの通信・一時ファイルを確認してください。",
);
defineDetails(
  [
    "INSTAGRAM_MEDIA_PUBLISH_FAILED",
    "TIKTOK_VIDEO_PUBLISH_FAILED",
    "TIKTOK_PHOTO_PUBLISH_FAILED",
  ],
  "解析用メディアの一時ストレージへの公開に失敗しました。",
  "Workerのストレージ権限・バケット設定とアップロード状況を確認してください。",
);
defineDetails(
  ["INSTAGRAM_MEDIA_CLEANUP_FAILED"],
  "Instagram解析用の一時メディアを削除できませんでした。",
  "Workerの一時ファイルと削除権限を確認してください。",
);
defineDetails(
  [
    "INSTAGRAM_MEDIA_UNSUPPORTED_MEDIA",
    "INSTAGRAM_VIDEO_UNSUPPORTED_MEDIA",
    "INSTAGRAM_MEDIA_COLLECTION_INVALID",
    "INSTAGRAM_VIDEO_MEDIA_INVALID",
    "TIKTOK_PHOTO_INPUT_INVALID",
  ],
  "SNS投稿のメディア形式・件数・順序が解析要件を満たしませんでした。",
  "投稿のメディア構成と対応条件を確認してください。取得できた一部だけを完全な投稿として解析しないでください。",
);
