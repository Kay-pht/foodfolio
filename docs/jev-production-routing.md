# Jev 本番導入・ルーティング設計

最終更新日: 2026-09-24
状態: 実装済み。PR #116で `not_recipe` 基盤、PR #118でJev production routingを本番コードへ反映済み。

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

### 2.1 PoC記録と採用判断の関係

`docs/poc-jev-media-routing-results.md` 等に残る `validationReady=false` / `productionQualified=false` は、その文書を作成した時点の検証母数と判定を保存するhistorical recordであり、数値や当時の判定は書き換えない。

2026-09-21時点では実ユーザーがいない開発段階であること、Jev障害時は既存routeへfail-openすること、media系は低確率時も `not_recipe` にせずmediaへ送ること、確率・threshold・最終routeをログへ残して後から再評価できることを前提に、プロジェクト判断として本書のroutingを初期実装から適用する。過去PoC文書のqualification flagをruntimeのrollout gateとして扱わない。

### 2.2 初期実装で固定する判断

本設計のレビュー時に以下を未確定事項として扱わない。

- 一般Webでは、URL取得・本文抽出・source判定等の機械処理は残すが、**「レシピらしい語があるか」等のsemanticな機械判定だけでJev到達前に終了しない**。本文を取得できた一般WebはJevへ渡し、recipe / non-recipeの意味判定をJevへ集約する。
- Instagramでは、取得・正規化後のmetadata / caption textが非空なら、**「レシピ」「材料」等のキーワード有無で先に除外せずJevへ渡す**。textが実際に存在しない場合だけJevを呼ばずmedia routeへ進む。
- TikTok動画・写真では、判定用textが存在する場合は**高コストなmedia解析より先にJevを呼び、text routeかmedia routeかを選ぶ**。textが存在しない場合だけJevを呼ばずmedia routeへ進む。
- YouTube / Instagram / TikTokのmedia解析は、foodfolioを動かす対象環境では**常時有効**を前提とする。必要な権限・API key・利用許可を満たせない環境は対応環境としてデプロイしない。
- Jevがmedia / video routeを選んだ後にmedia取得・Provider・解析が失敗した場合は、その解析を失敗として終了する。**不完全なtextだけでレシピ生成する経路へ戻さない**。
- ChatGPT / Gemini共有は初期実装から `p(non_recipe) >= 0.99` をhard `not_recipe` として適用する。0.99は絶対的正解率の意味ではなく、運用ログを見ながらsource別に後から調整する初期thresholdである。
- `not_recipe` はiOSとBackendを同時に対応させ、**初回リリース前に導入する**。現時点では互換性を維持すべき旧リリース版クライアントは存在しないため、旧iOS向けrollout gateは設けない。この前提が変わる場合だけ互換性設計を再検討する。
- YouTubeでtext routeを選んだ後、Z.ai結果に材料または手順が不足する場合はGemini videoへfallbackする。Geminiには利用可能な説明欄等のtextも動画と一緒に渡す。Geminiまで失敗した場合は解析失敗とし、textだけの不完全結果へ戻さない。

---

## 3. 全体アーキテクチャ

```text
URL / AI share URL
↓
SourceContentExtractor
↓
sourceごとの取得可否・形式判定
（一般Webはrecipeらしさだけで終了しない）
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

### 3.1 media解析は対象環境で常時有効

Jevはrouteを選ぶだけで、media利用に必要な権限・API key・利用許可を迂回しない。ただしfoodfolioを実際に動かす対象環境では、YouTube / Instagram / TikTokのmedia解析経路を常時利用可能な状態にする。

- YouTube Gemini video routeは有効化済みを前提とする
- Instagram media fallbackは有効化済みを前提とする
- TikTok動画・写真のmedia解析は、必要な利用許可を満たしたうえで有効化済みを前提とする

feature flagを実装上の安全装置として残す場合でも、対象環境でOFFにして運用することは想定しない。OFF、API key不足、必要権限不足は通常のrouting分岐ではなく**環境設定不備**として扱う。

Jevがmedia routeを選択した後にmedia取得・Provider・解析が失敗した場合、その解析は失敗として終了する。text routeへ戻って不完全なレシピを保存しない。

Jevのfail-openはJev自身が失敗した場合だけに適用し、Jev導入前と同じroute判定へ戻すことを意味する。media route選択後のmedia失敗をtextへfail-openする意味ではない。

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

一般Webでは、本文取得後に「レシピ」「材料」等の語が見つからないことだけを理由に `SourceContent` を失敗させたり、Jevを呼ばず終了したりしない。HTTP取得失敗、本文が空、上限超過等の**意味判定ではない取得エラー**はJev前に失敗してよいが、recipe / non-recipeの意味判定はJevへ渡す。

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

Z.ai text extractionで材料・手順が揃わない場合にGeminiへ進むのは意図したfallbackである。Geminiには公開動画URLだけでなく取得済みの説明欄等も同じ解析入力として渡す。Gemini routeまで進んで失敗した場合は解析失敗とし、Z.aiの不完全結果を保存しない。

### 6.3 Instagram

Instagramは、正規化後のmetadata / caption textが1文字でも存在する場合はJevへ渡す。「レシピ」「材料」等の特定語を含むかどうかでJev到達前にtextを破棄しない。ここでいう「metadata textなし」は、semanticなキーワード判定の結果ではなく、取得・正規化後に判定用textが実際に空である場合だけを指す。

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

### 6.5.1 media route選択後の失敗

Instagram / TikTok動画 / TikTok写真でJevがmedia routeを選択した場合、またはtext extractionが必須内容不足でmedia fallbackへ進んだ場合は、そのmedia解析を正しい次経路とみなす。

media取得、外部Provider、Schema validation等でmedia解析を完了できなければ解析失敗とする。**「せめて文章だけで保存する」目的でtext extractionへ戻ることはしない。**

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

AIチャット共有の `p(non_recipe) >= 0.99` hard rejectは初期実装から有効にする明示的なプロジェクト判断である。0.99未満はrejectせずZ.aiへ送る。0.99を「誤判定しない保証」とは扱わず、実運用のprobability・route・最終結果を観測して必要ならthresholdを変更する。

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

### 8.6 初回リリース前のiOS互換性

`not_recipe` はBackend API / syncとiOS decode / UIを同じリリース準備内で対応させる。

本設計時点ではアプリは未リリースであり、互換性を維持すべき旧iOSクライアントは存在しない。そのため「旧クライアントへ未知のstatusを返さないための段階的rollout」は初期実装の要件にしない。外部配布済みの旧buildが存在する状態へ前提が変わった場合は、hard `not_recipe` を生成する前に互換性方針を再設計する。

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

Jev requestには明示的なtimeoutを設定する。PR 2でPoCの実測レイテンシとWorker全体のtimeout制約を確認した結果、**初期timeoutは3000ms** とする。timeout時も同一delivery内でJevを再試行せず、即fail-openする。

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

- 一般Webでrecipeらしい語を含まない本文でも、取得可能な本文があればJevまで到達する
- 一般Web `p(non_recipe) >= 0.80` → `not_recipe`
- 一般Web threshold未満 → Z.ai
- AI chat `p(non_recipe) >= 0.99` → `not_recipe`
- AI chat `p(non_recipe) < 0.99` → Z.ai
- AI chat recipe probabilityが0.77程度でもrejectしない
- YouTube description insufficient → Jev未呼び出し + Gemini
- YouTube sufficient + threshold以上 → text
- YouTube text incomplete → 説明欄等のtextも含めてGemini
- YouTube Gemini failure → 解析失敗。Z.ai不完全結果へ戻らない
- YouTube threshold未満 → Gemini
- Instagram threshold以上 → text
- Instagram text incomplete → media
- Instagram threshold未満 → media
- TikTok動画 threshold以上 → text
- TikTok動画 text incomplete → video
- TikTok写真 threshold以上 → text
- TikTok写真 text incomplete → photo media
- TikTok写真 threshold未満 → photo media
- Instagram / TikTokでmedia route選択後のmedia失敗 → 解析失敗。textへ戻らない
- 対象deploymentではYouTube / Instagram / TikTok media機能が有効であることを設定検証する
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

## 16. 実装PRの分割と完了状態

Jev本番導入は2PRに分けて実装し、両方ともmainへ反映済み。

### 16.1 Specification as Code

設計PRでは `specs/tasks/*.yaml` を変更せず、既存の `JEV-RECIPE-GATE-POC-001` はPoC専用のhistorical specとして維持した。production routingの契約へ流用・書き換えしていない。

実装PRでは、production挙動へ影響するコード変更へ着手する前に対象範囲のSpecification as Codeを追加し、PR #116では `JEV-PRODUCTION-NOT-RECIPE-001`、PR #118では `JEV-PRODUCTION-ROUTING-001` を実装・検証の正本として確定した。

- PR 1では `not_recipe` のstate / API / iOS / notification契約をspec化する
- PR 2ではJev adapter、fail-open、source別routing、threshold、observability契約をspec化する

これにより、PoC specの「production routing unchanged」という契約と、本番導入実装のSpecification as Codeを混在させない。

### PR 1: not_recipe基盤

状態: 完了（PR #116）

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

PR #116ではJev production routingを有効化せず、`not_recipe` を安全に扱う基盤だけを先に導入した。routing本体はPR #118で追加済み。

### PR 2: Jev production routing

状態: 完了（PR #118）

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

## 17. 設計PR時点の非変更範囲（履歴）

以下は本書を最初に追加したdocs-only設計PRでは変更しなかった範囲である。現在はPR #116 / #118により必要なproduction実装が反映済み。

設計PRでは変更しなかったもの:

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
