# Jev 本番導入・ルーティング設計

最終更新日: 2026-09-21
状態: 承認済み設計。実装は後続PRで行う。

## 1. 目的

Jevをレシピ抽出モデルそのものとしてではなく、既存のZ.ai / Gemini / メディア解析の前段に置く軽量なsemantic gate / routerとして導入する。

目的は以下。

- 明確なnon-recipeを高コストな解析へ送らない
- YouTube / Instagram / TikTokで、text解析とmedia解析を適切に振り分ける
- Jevが利用できない場合も既存解析を継続し、Jevを単一障害点にしない
- 実運用ログから閾値を後で再評価できるようにする
- PoCコードをproductionから直接参照せず、本番用の境界とadapterを設ける

本書はJev導入に関する正本とし、既存の要件定義・実装設計・AIデータ取扱い・技術選定書は本書を参照する。

---

## 2. 導入前提

Jevの分類は二択とする。

```text
recipe
non_recipe
```

routingにはchoiceだけではなく以下の確率を使用する。

```text
p(recipe)
p(non_recipe)
```

Jevが返す確率は「最終的なレシピ抽出結果」ではない。どの解析経路へ進むか、または明確なnon-recipeとして終了するかを決めるために使用する。

---

## 3. 全体アーキテクチャ

```text
URL / AI share URL
↓
SourceContentExtractor
↓
sourceごとの機械的な前判定
↓
必要な場合だけJev
↓
├─ hard non-recipe
│    → not_recipe
├─ text fast route
│    → Z.ai text extraction
│       └─ 必須内容不足ならmedia / video fallback
└─ media / video route
     → 既存media / Gemini解析
```

JevはSourceContentExtractorの後、Z.ai / Gemini / media解析の前に置く。

以下の既存責務は維持する。

- Cloud Tasks
- Worker ownership / lease
- SourceContent抽出
- Z.ai / Gemini / media adapter
- Recipe Schema validation
- DB反映
- 通知
- 既存解析のretry方針

### 3.1 既存feature gate / 利用許可を迂回しない

Jevはrouteを選ぶだけで、既存のmedia feature flagや利用許可を上書きしない。

- YouTubeでGemini routeを選んでも、実際のGemini利用は `YOUTUBE_GEMINI_FALLBACK_ENABLED` に従う
- Instagramでmedia routeを選んでも、既存のInstagram media fallback有効条件に従う
- TikTok動画・写真でmedia routeを選んでも、`TIKTOK_MEDIA_ANALYSIS_ENABLED` と既存の利用許可条件に従う

media routeが必要だが該当機能が無効な場合は、Jevが強制的にmedia取得を有効化してはならない。既存の「fallback disabled」としての失敗動作を維持する。

Jevのfail-openも「機能を強制有効化する」という意味ではない。Jev導入前と同じroute判定へ戻すことだけを意味する。

---

## 4. Application境界

Application層はTypeSafe固有APIへ直接依存しない。

概念上、以下のような抽象を設ける。

```ts
interface RecipeContentClassifier {
  classify(input: {
    sourceType: SourceType;
    text: string;
  }): Promise<RecipeContentClassification>;
}
```

production adapterがTypeSafe / Jev APIを実装する。

```text
Application
  ↓
RecipeContentClassifier
  ↓
Infrastructure
  ↓
TypeSafe / Jev
```

PoCの `poc/jev-recipe-gate/jev.ts` をproductionから直接importしない。PoCで確認したrequest schema、response validation、エラー分類等は必要な範囲でproduction adapterへ移植する。

---

## 5. 初期閾値

初期値は以下とする。

| 用途                                 |                初期条件 |
| ------------------------------------ | ----------------------: |
| 一般Web hard non-recipe              | `p(non_recipe) >= 0.80` |
| YouTube text route                   |     `p(recipe) >= 0.99` |
| Instagram text route                 |     `p(recipe) >= 0.99` |
| TikTok動画 text route                |     `p(recipe) >= 0.99` |
| TikTok写真 text route                |     `p(recipe) >= 0.99` |
| ChatGPT / Gemini共有 hard non-recipe | `p(non_recipe) >= 0.99` |

一般Webの0.80とmedia系の0.99はPoC結果を初期根拠とする。

AIチャット共有は実URLでrecipe判定まで確認済みだが、non-recipe実URL母数が不足しているため、0.99から保守的に開始する。

閾値はsourceごとに独立して変更できる構成とする。同じ0.99から開始しても、将来同じ値を維持する前提にはしない。

想定環境変数:

```text
JEV_GENERAL_WEB_NON_RECIPE_THRESHOLD=0.80
JEV_YOUTUBE_RECIPE_THRESHOLD=0.99
JEV_INSTAGRAM_RECIPE_THRESHOLD=0.99
JEV_TIKTOK_VIDEO_RECIPE_THRESHOLD=0.99
JEV_TIKTOK_PHOTO_RECIPE_THRESHOLD=0.99
JEV_AI_CHAT_NON_RECIPE_THRESHOLD=0.99
```

閾値の妥当性検証に必要なログ仕様は後述する。

---

## 6. source別routing

### 6.1 一般Web

対象:

- `web`
- `kurashiru`
- `cookpad`

```text
SourceContent
↓
Jev
↓
p(non_recipe) >= 0.80
├─ yes → not_recipe
└─ no  → 従来どおりZ.ai
```

0.80未満を「recipe確定」とは扱わない。曖昧なものは従来解析へ送る。

### 6.2 YouTube

既存の `assessYoutubeDescription()` を先に実行する。

```text
title / description取得
↓
description sufficiency
├─ insufficient / unknown
│    → Jevを呼ばずGemini video route
└─ sufficient
     ↓
     Jev
     ↓
     p(recipe) >= 0.99
     ├─ yes → Z.ai text extraction
     │         ├─ ingredients > 0 AND steps > 0 → completed
     │         └─ 不足 → Gemini video fallback
     └─ no  → Gemini video route
```

Jevの確率が低いことだけを理由にYouTubeを `not_recipe` にしない。説明欄にレシピがなくても動画内に存在する可能性があるため。

### 6.3 Instagram

```text
metadata textなし
→ media route

metadata textあり
↓
Jev
↓
p(recipe) >= 0.99
├─ yes → Z.ai text extraction
│         ├─ ingredients > 0 AND steps > 0 → completed
│         └─ 不足 → media fallback
└─ no  → media route
```

Jevだけで `not_recipe` にはしない。

### 6.4 TikTok動画

```text
textなし
→ video route

textあり
↓
Jev
↓
p(recipe) >= 0.99
├─ yes → Z.ai text extraction
│         ├─ ingredients > 0 AND steps > 0 → completed
│         └─ 不足 → video fallback
└─ no  → video route
```

Jevだけで `not_recipe` にはしない。

### 6.5 TikTok写真

既存の「captionが十分でも必ず画像解析する」仕様を変更する。

```text
captionなし
→ photo media route

captionあり
↓
Jev
↓
p(recipe) >= 0.99
├─ yes → Z.ai text extraction
│         ├─ ingredients > 0 AND steps > 0 → completed
│         └─ 不足 → photo media fallback
└─ no  → photo media route
```

Jevの0.99は「textだけで一度試す価値が高い」というroute判定であり、textだけで完成する保証ではない。

### 6.6 ChatGPT / Gemini共有

共有会話本文全体をJevへ渡す。

```text
shared conversation
↓
Jev
↓
p(non_recipe) >= 0.99
├─ yes → not_recipe
└─ no  → 従来どおりZ.ai
```

AIチャットでは `p(recipe) >= 0.99` を要求しない。実URL検証でChatGPTのrecipe例が `p(recipe) ≈ 0.77-0.79` だったため、recipe probabilityが低いこと自体はreject条件にしない。

---

## 7. text fast routeの完了条件

Jevがtext routeを選択しても、それだけで解析完了にはしない。

既存の必須内容判定を安全網として残す。

```text
ingredients.length > 0
AND
steps.length > 0
```

満たす場合:

- text routeで完了

満たさない場合:

- YouTube → Gemini video
- Instagram → media
- TikTok動画 → video
- TikTok写真 → photo media

これによりJevの誤routingやZ.aiの抽出不足だけでレシピを失わない。

---

## 8. not_recipe

### 8.1 status

`AnalysisStatus` に以下を追加する。

```text
not_recipe
```

意味を明確に分離する。

- `failed`: 本来解析したかったが技術的・Provider・取得等の理由で完了できなかった
- `not_recipe`: 正常なsemantic判定の結果、1つの具体的なレシピではないと判断した

### 8.2 terminal state

`not_recipe` はterminal stateとする。

- Worker retryしない
- Cloud Tasks再配送の理由にしない
- AnalysisAdmissionを終了する
- Recipeレコードは削除しない

### 8.3 保存・UI

保持する:

- Recipe ID
- original URL
- normalized URL
- source type
- 保存日時

通常のレシピ編集は不可とする。

表示文言:

```text
レシピとして判定できませんでした
```

ユーザーは元URLを開ける。Recipeの削除も可能とする。

### 8.4 通知

既存の「レシピ解析通知」設定を利用し、ONの場合は `not_recipe` 専用通知を送る。

```text
レシピとして判定できませんでした
```

`failed` の解析失敗通知とは分離する。通知設定自体は増やさない。

### 8.5 hard reject対象

初期実装でJev単独のhard `not_recipe` を許可するのは以下だけ。

- 一般Web
- ChatGPT共有
- Gemini共有

YouTube / Instagram / TikTokはmedia側にレシピが存在する可能性があるため、Jevの低いrecipe probabilityだけでは `not_recipe` にしない。

---

## 9. Jev障害時のfail-open

Jevは補助routerであり、解析処理の単一障害点にしない。

Jevが失敗した場合は、そのWorker実行内で即座にJev導入前の従来routeへ戻る。

```text
Jev success
→ probability routing

Jev failure
→ fail-open
→ existing route
```

例:

- 一般Web → Z.ai
- ChatGPT / Gemini共有 → Z.ai
- YouTube description sufficient → 既存YouTube route
- Instagram / TikTok動画 → 既存text-first + media fallback
- TikTok写真 → 既存photo media route

Jev障害だけを理由に以下へ遷移しない。

- `pending`
- `failed`

Jev failureはWorker retry対象外とする。

---

## 10. Jev request / retry方針

productionではJev requestを **1 Worker delivery（Cloud Tasksの1回のanalysis attempt）につき最大1回** とする。

```text
Jev request
├─ success → routing
└─ timeout / network / 429 / 529 / invalid response / body read failure
     → retryしない
     → 即fail-open
```

PoCではretry挙動を検証したが、本番でのJevは必須処理ではないため、Jev自身の成功率向上よりも解析レイテンシと単純性を優先する。

ここでいう「1回」はJev API自身を同じWorker delivery内で再試行しないという意味である。Jev成功後にZ.ai・media・DB等の既存retryable errorでCloud Tasksが新しいdeliveryを開始した場合、その新しいdeliveryではJevを再度最大1回呼んでよい。Jev probabilityやrouting decisionをこの制約のためだけにDBへ永続化しない。

Jev requestには明示的なtimeoutを設定する。具体的な初期timeout値は実装PRで、PoCの実測レイテンシとWorker全体のtimeout制約を確認して確定する。ただし複数attemptは導入しない。

---

## 11. 閾値再評価のためのObservability

### 11.1 目的

閾値は将来変更する前提とする。

ログから以下を確認できるようにする。

- sourceごとのprobability分布
- 現在のthreshold付近に何件あるか
- どのrouteへ進んだか
- text fast routeが実際にtextだけで完了したか
- media fallbackが必要だったか
- Jev障害がどの程度発生しているか
- model変更前後で確率分布が変化していないか

### 11.2 classification / routing log

Jevを呼んだ各解析で構造化ログを残す。

最低限:

```text
event=jev_routing_decision

recipeId
analysisAttempt
sourceType
mediaKind
jevModel

recipeProbability
nonRecipeProbability

thresholdName
thresholdValue
thresholdMatched

selectedRoute

jevSucceeded
jevLatencyMs
jevFailureClass

inputChars
inputSha256
```

`inputSha256` はJevへ送った正規化済みtextのSHA-256とする。本文そのものは保存しない。

これにより、将来同じURLを再取得して再検証するときに、再取得した入力hashが当時と一致するか確認できる。

### 11.3 final outcome log

Jev成功後は最終結果にも分類snapshotを含める。

最低限:

```text
event=jev_routing_outcome

recipeId
analysisAttempt
sourceType
mediaKind
jevModel

recipeProbability
nonRecipeProbability
thresholdName
thresholdValue
selectedRoute

finalRoute
textExtractionComplete
mediaFallbackUsed
finalAnalysisStatus
```

確率とthresholdをoutcome側にも重複して持たせ、Cloud Logging上で複雑なevent joinをしなくても閾値候補を集計しやすくする。

### 11.4 ログだけで断定しない

現在のthreshold未満のmedia投稿はtext extraction自体を実行しないため、ログだけでは「より低いthresholdでもtextで成功していた」とは断定できない。

閾値変更手順は以下とする。

1. ログから候補probability帯を抽出する
2. `recipeId` から元URLを特定する
3. 対象URLを再取得してJev / text extractionを再評価する
4. `inputSha256` が当時と一致するケースを優先して評価する
5. false fast-routeが許容範囲であることを確認してthresholdを変更する

一般Web / AI chatのhard reject thresholdを下げる場合は特にfalse reject確認を必須とする。

### 11.5 ログ保持

threshold再評価に必要な期間よりログ保持期間が短い状態を避ける。

実装・運用時にCloud Loggingのretentionを確認し、不足する場合はlog bucket retentionまたはexport方針を別途設定する。

### 11.6 ログ禁止事項

通常ログへ以下を出さない。

- page本文
- caption全文
- AI chat会話全文
- Jev raw response全文
- API key
- Authorization header
- signed media URL

---

## 12. AIデータ送信境界

Jevへ送るのはSourceContentから抽出した判定用textだけとする。

送らないもの:

- Foodfolio User ID
- email
- Firebase UID
- device token
- authentication token
- Recipeの所有者情報
- private credential

Jev requestとログを混同しない。Jevへ送信するpage contentも通常ログには保存しない。

詳細は `docs/ai-data-handling.md` を参照する。

---

## 13. Secrets / configuration

production WorkerにTypeSafe API keyを追加する。

```text
TYPESAFE_API_KEY
```

Secret ManagerからWorkerへ渡す。

API serviceはJevを呼ばないため、原則としてAPI側には不要。

`off / observe / enforce` の3モードは初期実装では設けない。現時点はdev環境のみで実ユーザーがいないため、導入時からroutingへ反映する。

安全性はmodeではなく以下で担保する。

- 1 attempt
- fail-open
- media fallback
- text必須内容確認
- source別threshold
- structured logging

---

## 14. state transition

```text
pending
↓
processing
├─ recipe正常解析
│    → completed
├─ hard non-recipe
│    → not_recipe
├─ Jev failure
│    → fail-openして解析継続
├─ 従来解析側のretryable error
│    → pending
└─ 従来解析側の最終失敗
     → failed
```

`retryable error → pending` はJev errorを意味しない。Jev errorは必ずfail-openする。

---

## 15. テスト要件

通常CIでは実TypeSafe APIを呼ばず、fake classifierを使う。

最低限以下を固定する。

### Jev adapter

- 正常response parse
- probability validation
- timeout → fail-open可能なerror
- network error → fail-open可能なerror
- 429 → retryせずfail-open
- 529 → retryせずfail-open
- response body read failure → retryせずfail-open
- malformed JSON → retryせずfail-open
- 1 Worker delivery内でrequest最大1回

### routing

- 一般Web `p(non_recipe) >= 0.80` → `not_recipe`
- 一般Web threshold未満 → Z.ai
- AI chat `p(non_recipe) >= 0.99` → `not_recipe`
- AI chat recipe probabilityが0.77程度でもrejectしない
- YouTube description insufficient → Jev未呼び出し + Gemini
- YouTube sufficient + threshold以上 → text
- YouTube text incomplete → Gemini
- YouTube threshold未満 → Gemini
- Instagram threshold以上 → text
- Instagram text incomplete → media
- Instagram threshold未満 → media
- TikTok動画 threshold以上 → text
- TikTok動画 text incomplete → video
- TikTok写真 threshold以上 → text
- TikTok写真 text incomplete → photo media
- TikTok写真 threshold未満 → photo media
- 各sourceでJev failure → 従来route

### not_recipe

- terminal state
- Worker retryなし
- AnalysisAdmission終了
- API / sync decode
- iOS decode /表示
- 通常編集不可
- PATCHは `409 RECIPE_NOT_EDITABLE`
- 元URL閲覧可能
- 削除可能
- 専用通知

### observability

- probability / threshold / routeが構造化ログへ出る
- final outcomeにclassification snapshotが残る
- input本文がログに出ない
- `inputSha256` が正規化済みJev入力と一致する

---

## 16. 実装PRの分割

Jev本番導入は2PRに分ける。

### PR 1: not_recipe基盤

対象:

- Prisma `AnalysisStatus.not_recipe`
- migration
- Backend state transition
- API / sync
- iOS decode / UI
- 編集不可
- 元URL閲覧 / 削除
- 専用通知
- tests
- 関連docs更新

このPRではJev production routingをまだ有効化しない。

### PR 2: Jev production routing

対象:

- `RecipeContentClassifier`
- TypeSafe / Jev production adapter
- Jev request 1 attempt / Worker delivery
- fail-open
- source別threshold
- source別routing
- text incomplete → media / video fallback
- structured logging
- input hash
- Secret Manager / Terraform / Worker config
- tests
- 関連docs更新

2PRに分けることで、「新statusの互換性」と「Jev routingの正しさ」を独立してレビューできるようにする。

---

## 17. 今回のdocs PRで実装しないもの

本ドキュメント追加PRは設計確定だけを行う。

変更しない:

- production code
- Prisma schema / migration
- iOS code
- Terraform
- environment files
- task spec YAML
- CI
- runtime configuration

---

## 18. 非対象

Jev本番導入でも初期段階では以下を行わない。

- JevでRecipeを生成する
- Jev probabilityのRecipe DB永続化
- Jev raw responseの保存
- threshold変更UI
- sourceごとの自動threshold最適化
- `off / observe / enforce`
- 既存Recipeの自動再判定
- 既存failed Recipeの自動再実行
- media sourceをJevだけでhard `not_recipe` にすること
