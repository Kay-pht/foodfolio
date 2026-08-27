# foodfolio MVP 実装設計書

## 1. 本書の目的

本書は、foodfolio MVPの実装時にデータ構造・API・iOS構成・Backend構成・非同期処理・検索・通知・エラー処理について大きく迷わない状態を作ることを目的とする。

本書は以下を前提とする。

- `docs/requirements-specification.md`
- `docs/basic-design.md`
- `docs/ui-ux-design.md`
- `docs/technology-selection.md`
- `docs/poc-validation-results.md`
- `poc/shared/recipe-schema.json`
- 既存PoCコード

要件・基本設計・技術選定と本書が衝突する場合、原則として上位工程の決定を優先する。ただし、本書で明示的に詳細化した実装上のルールは本書を実装基準とする。

---

## 2. 実装設計で確定するMVP方針

### 2.1 ユーザー決定事項

| 項目 | 決定 |
| --- | --- |
| タグ検索 | 1タグのみ選択可能 |
| URL重複 | 明らかな差異を正規化して同一URL判定 |
| 検索履歴 | iPhone端末内に保存 |
| `1〜2人分` 等の範囲人数 | 原文は表示するが人数変更・比例計算は行わない |
| レシピ解析通知 | 初期ON |
| 通知許可要求 | 初回ログイン完了直後に要求 |
| OS通知拒否時 | アプリ内通知設定はONを維持し、OS設定が無効であることを表示 |
| アカウント削除 | 関連ユーザーデータを即時完全削除 |

### 2.2 MVPの実装原則

- iOSとBackendを同一GitHubリポジトリで管理する。
- BackendはNode.js + TypeScriptの単一コードベースとし、APIとWorkerを別entrypoint・別Cloud Run Serviceとして起動する。
- APIとWorkerのためにマイクロサービスを細分化しない。
- Firebase AuthenticationのFirebase UIDを認証上の外部ユーザー識別子とする。
- アプリケーションDBでは独自のUUIDを主キーとして使用する。
- AI解析はURL保存APIと分離し、Cloud Tasks経由で非同期実行する。
- AI解析中でもRecipeは利用可能とする。
- 外部URLから取得した本文そのものやAIのraw responseはDBへ永続保存しない。
- PoCコードをそのまま本番entrypointとして使用せず、検証済みロジックを本番モジュールへ移植する。
- MVPでは不要な抽象化・汎用化を増やさない。ただしAI Provider、URL取得、通知、認証、DBは外部依存境界としてAdapter化する。

---

## 3. 採用アーキテクチャ

```text
┌─────────────────────────────┐
│ iOS App                     │
│ Swift / SwiftUI / iOS 26+   │
└──────────────┬──────────────┘
               │ Firebase ID Token
               ▼
┌─────────────────────────────┐
│ Cloud Run: foodfolio-api    │
│ Node.js / TypeScript        │
│ Fastify                     │
└───────┬─────────────┬───────┘
        │             │
        │ Prisma      │ Cloud Tasks enqueue
        ▼             ▼
┌───────────────┐  ┌─────────────────┐
│ Neon Postgres │  │ Cloud Tasks     │
└───────────────┘  └────────┬────────┘
                            │ OIDC authenticated HTTP
                            ▼
                   ┌──────────────────────┐
                   │ Cloud Run Worker     │
                   │ foodfolio-worker     │
                   └───────┬──────────────┘
                           │
                ┌──────────┼──────────┐
                ▼          ▼          ▼
          URL抽出処理   Z.ai API   Neon Postgres
                │          │
                └────┬─────┘
                     ▼
              Recipe Schema validation
                     │
                     ▼
                  DB更新
                     │
                     ▼
                  FCM → APNs
```

### 3.1 Backend HTTP Framework

Backend API / WorkerのHTTPサーバーは **Fastify** を採用する。

理由：

- API / Workerの小規模HTTP endpointを同じ方式で実装できる
- JSON Schemaベースのrequest validationと相性がよい
- 共通error handler・loggingをまとめやすい
- MVPで必要な機能に対して十分軽量である

AI出力のSchema validationは既存PoCと同様に **Ajv** を使用する。

---

## 4. リポジトリ構成

MVPではNode.js packageを不要に分割せず、現在のroot packageをBackend / PoC共通のNode.js packageとして拡張する。

```text
foodfolio/
├─ docs/
│  ├─ requirements-specification.md
│  ├─ basic-design.md
│  ├─ ui-ux-design.md
│  ├─ technology-selection.md
│  ├─ poc-validation-results.md
│  └─ implementation-design.md
│
├─ ios/
│  └─ Foodfolio/
│     ├─ App/
│     ├─ Core/
│     ├─ Features/
│     └─ Resources/
│
├─ src/
│  ├─ entrypoints/
│  │  ├─ api.ts
│  │  └─ worker.ts
│  ├─ api/
│  │  ├─ routes/
│  │  ├─ schemas/
│  │  └─ errors/
│  ├─ application/
│  │  ├─ recipes/
│  │  ├─ tags/
│  │  ├─ settings/
│  │  ├─ users/
│  │  └─ analysis/
│  ├─ domain/
│  │  ├─ recipe/
│  │  ├─ tag/
│  │  └─ user/
│  ├─ infrastructure/
│  │  ├─ auth/
│  │  ├─ db/
│  │  ├─ ai/
│  │  ├─ url/
│  │  ├─ tasks/
│  │  └─ notifications/
│  ├─ config/
│  └─ shared/
│
├─ schemas/
│  └─ extracted-recipe.schema.json
│
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
│
├─ infra/
│  └─ terraform/
│
├─ poc/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
│
├─ Dockerfile
├─ package.json
└─ package-lock.json
```

### 4.1 Recipe Schemaの配置

現在の `poc/shared/recipe-schema.json` をPoC専用品のまま複製し続けない。

実装開始時に以下へ移し、**本番・PoC双方が参照する単一のSchema**とする。

```text
schemas/extracted-recipe.schema.json
```

これによりPoCと本番のSchema差分を防止する。

---

## 5. Backendの責務分離

### 5.1 API

`foodfolio-api` の責務：

- Firebase ID Token検証
- Userの作成 / 解決
- Recipe CRUD
- URL validation / URL正規化 / 重複判定
- Tag CRUDのMVP範囲
- RecipeTag付与 / 解除
- 検索
- UserSetting取得 / 更新
- FCM Token登録 / 削除
- アカウント削除
- Cloud Tasks enqueue

APIでは外部URL本文取得やAI解析を実行しない。

### 5.2 Worker

`foodfolio-worker` の責務：

- Cloud Tasksからの認証済みTask受信
- Recipe解析状態更新
- 外部URL取得
- source / image metadata取得
- AI入力テキスト生成
- Z.ai呼び出し
- JSON parse / Schema validation
- AI結果のDB反映
- 解析成功 / 失敗通知
- retry可能 / 不可能エラー判定

### 5.3 Domain / Application

Domain / Application層はFastify、Firebase、Prisma、Z.aiなど特定の外部SDKに直接依存させない。

主要interface例：

```ts
interface RecipeExtractor {
  extract(input: RecipeSource): Promise<ExtractedRecipe>;
}

interface SourceContentExtractor {
  extract(url: URL): Promise<SourceContent>;
}

interface NotificationSender {
  sendRecipeAnalysisCompleted(input: NotificationInput): Promise<void>;
  sendRecipeAnalysisFailed(input: NotificationInput): Promise<void>;
}

interface AnalysisTaskQueue {
  enqueueRecipeAnalysis(recipeId: string): Promise<void>;
}
```

---

## 6. 共通データ仕様

### 6.1 ID

アプリケーションDBの主キーはUUIDを使用する。

- User ID: UUID
- Recipe ID: UUID
- Ingredient ID: UUID
- RecipeStep ID: UUID
- Tag ID: UUID
- DeviceToken ID: UUID

Firebase UIDはUserの外部識別子として別カラムに保持する。

### 6.2 日時

DBはtimestamp with time zone相当でUTC保存する。

APIではISO 8601文字列として返却する。

例：

```text
2026-08-27T06:40:06.000Z
```

UI表示時にiOS側で端末timezoneへ変換する。

### 6.3 文字コード

UTF-8を前提とする。

---

## 7. データモデル

### 7.1 User

```text
User
- id: UUID PK
- firebaseUid: string UNIQUE NOT NULL
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
```

メールアドレスやログインProviderはFirebase Authenticationを正とし、MVPではDBへ重複保存しない。

アカウント画面のログイン情報・ログイン方法はiOS側のFirebase User情報から取得する。

### 7.2 UserSetting

```text
UserSetting
- userId: UUID PK / FK -> User.id ON DELETE CASCADE
- recipeAnalysisNotificationEnabled: boolean NOT NULL DEFAULT true
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
```

レシピ解析通知は初期ONとする。

### 7.3 Recipe

```text
Recipe
- id: UUID PK
- userId: UUID FK -> User.id ON DELETE CASCADE
- originalUrl: text NOT NULL
- normalizedUrl: text NOT NULL
- sourceType: enum NOT NULL
- sourceLabel: string NOT NULL
- title: string NOT NULL DEFAULT "解析中のレシピ"
- imageUrl: text NULL
- servingsValue: float NULL
- servingsRaw: string NULL
- cookingTimeMinutes: integer NULL
- genre: enum NULL
- analysisStatus: enum NOT NULL DEFAULT pending
- analysisAttemptCount: integer NOT NULL DEFAULT 0
- analysisErrorCode: string NULL
- titleUserEdited: boolean NOT NULL DEFAULT false
- genreUserEdited: boolean NOT NULL DEFAULT false
- ingredientsUserEdited: boolean NOT NULL DEFAULT false
- analysisStartedAt: datetime NULL
- analysisCompletedAt: datetime NULL
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
```

制約：

```text
UNIQUE(userId, normalizedUrl)
```

主要index：

```text
INDEX(userId, createdAt DESC)
INDEX(userId, genre)
INDEX(userId, analysisStatus)
```

### 7.4 SourceType

```text
youtube
instagram
tiktok
kurashiru
cookpad
web
```

`sourceLabel` はUI表示用文字列とする。

例：

```text
youtube  -> YouTube
instagram -> Instagram
web -> example.com
```

### 7.5 AnalysisStatus

正式な内部statusは以下に確定する。

```text
pending
processing
completed
failed
```

`partial` は独立statusにしない。

一部項目が取得できなくても解析処理そのものが正常終了した場合は `completed` とする。

### 7.6 Ingredient

```text
Ingredient
- id: UUID PK
- recipeId: UUID FK -> Recipe.id ON DELETE CASCADE
- name: string NOT NULL
- amount: string NULL
- sortOrder: integer NOT NULL
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
```

MVPでは分量を数値・単位へ完全分解してDB保存しない。

原典表現を保持するため `amount` は文字列とする。

### 7.7 RecipeStep

```text
RecipeStep
- id: UUID PK
- recipeId: UUID FK -> Recipe.id ON DELETE CASCADE
- text: text NOT NULL
- sortOrder: integer NOT NULL
```

手順が0件の場合はRecipeStepを作成しない。

### 7.8 Tag

```text
Tag
- id: UUID PK
- userId: UUID FK -> User.id ON DELETE CASCADE
- name: string NOT NULL
- normalizedName: string NOT NULL
- createdAt: datetime NOT NULL
```

制約：

```text
UNIQUE(userId, normalizedName)
```

### 7.9 RecipeTag

```text
RecipeTag
- recipeId: UUID FK -> Recipe.id ON DELETE CASCADE
- tagId: UUID FK -> Tag.id ON DELETE CASCADE
- createdAt: datetime NOT NULL

PRIMARY KEY(recipeId, tagId)
```

RecipeとTagが同一Userに属することはApplication層で必ず検証する。

### 7.10 DeviceToken

```text
DeviceToken
- id: UUID PK
- userId: UUID FK -> User.id ON DELETE CASCADE
- fcmToken: text UNIQUE NOT NULL
- createdAt: datetime NOT NULL
- updatedAt: datetime NOT NULL
- lastSeenAt: datetime NOT NULL
```

同一FCM Tokenが別Userで登録された場合は現在ログイン中のUserへ再紐付けする。

ログアウト時はその端末のTokenを削除する。

---

## 8. Prisma Schema方針

Prisma Migrateを使用する。

runtime接続はNeon pooled connection stringを利用する。

migration実行用にはruntimeとは別にdirect connection stringをSecretとして用意する。

MVPではmigrationをアプリ起動時に自動実行しない。

GitHub Actionsのdeploy flowで次の順序を基本とする。

```text
Test
↓
Build
↓
Prisma migrate deploy
↓
Cloud Run deploy
```

---

## 9. 認証・ユーザー解決

### 9.1 iOS → API

すべての認証必須APIで以下を送る。

```http
Authorization: Bearer <Firebase ID Token>
```

BackendはFirebase Admin SDKでTokenを検証する。

Clientから `userId` を送信して認可判定する方式は禁止する。

### 9.2 User同期

認証済みrequestごとにFirebase UIDからUserを解決する。

Userが存在しない場合は作成する。

```text
Firebase ID Token
↓
Firebase UID
↓
User.firebaseUid lookup
├─ exists -> Userを利用
└─ missing -> User + UserSetting(default ON)を作成
```

### 9.3 認可

Recipe / Tag / DeviceToken等のユーザーデータは、必ず認証済みUser IDをquery条件へ含める。

例：

```text
recipe.id = :recipeId
AND recipe.userId = :authenticatedUserId
```

他UserのIDを指定された場合も存在を漏らさないため原則404として扱う。

---

## 10. REST API

API prefixは `/v1` とする。

### 10.1 Recipe API

#### POST `/v1/recipes`

URLからRecipeを即時保存する。

Request：

```json
{
  "url": "https://example.com/recipe/123"
}
```

処理：

```text
認証
↓
URL validation
↓
URL normalization
↓
同一Userの重複確認
↓
Recipe保存
  title = 解析中のレシピ
  analysisStatus = pending
↓
Cloud Tasks enqueue
↓
201 Created
```

外部ページ本文取得・AI解析はこのAPIでは行わない。

重複時：

```http
409 Conflict
```

error detailsに既存 `recipeId` を含め、iOSは既存Recipe詳細への導線を表示する。

Cloud Tasks enqueueに失敗した場合もRecipe自体は削除しない。

その場合：

```text
analysisStatus = failed
analysisErrorCode = TASK_ENQUEUE_FAILED
```

としてRecipeを返す。

#### GET `/v1/recipes`

ホーム一覧用。

Query：

```text
cursor: optional
limit: optional, default 30, max 50
```

並び順：

```text
createdAt DESC, id DESC
```

ResponseはRecipe summaryのみ返す。

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "親子丼",
      "imageUrl": "https://...",
      "analysisStatus": "completed",
      "createdAt": "2026-08-27T06:40:06.000Z"
    }
  ],
  "nextCursor": "opaque-cursor-or-null"
}
```

#### GET `/v1/recipes/:recipeId`

Recipe詳細取得。

Responseに含める主な項目：

- id
- originalUrl
- sourceType
- sourceLabel
- title
- imageUrl
- servingsValue
- servingsRaw
- cookingTimeMinutes
- genre
- analysisStatus
- analysisErrorCode
- ingredients
- steps
- tags
- createdAt
- updatedAt

#### PATCH `/v1/recipes/:recipeId`

編集可能項目のみ更新する。

Request例：

```json
{
  "title": "自分用の親子丼",
  "genre": "主菜",
  "ingredients": [
    { "name": "鶏もも肉", "amount": "250g" },
    { "name": "卵", "amount": "2個" }
  ]
}
```

すべてoptionalとし、送信された項目だけ変更する。

変更時のflag：

```text
title変更 -> titleUserEdited = true
genre変更 -> genreUserEdited = true
ingredients変更 -> ingredientsUserEdited = true
```

画像、人数、調理時間、手順、URL、解析状態はこのAPIから変更不可とする。

#### DELETE `/v1/recipes/:recipeId`

Recipeを完全削除する。

Ingredient、RecipeStep、RecipeTagはcascade deleteする。

成功：

```http
204 No Content
```

### 10.2 Search API

#### GET `/v1/recipes/search`

Query：

```text
q: optional
 genre: optional
 tagId: optional
 cursor: optional
 limit: optional, default 30, max 50
```

`q / genre / tagId` の最低1つを指定する。

タグは1タグのみ選択可能とする。

条件の結合：

```text
q AND genre AND tag
```

指定されていない条件は無視する。

テキスト検索：

```text
Recipe.title OR Ingredient.name
```

`q` は前後空白を除去し、空白区切りの複数tokenがある場合は **AND** とする。

各tokenについて、料理名または材料名のいずれかに部分一致すればよい。

例：

```text
q = "鶏肉 玉ねぎ"
```

は概念上以下とする。

```text
(title contains 鶏肉 OR ingredient contains 鶏肉)
AND
(title contains 玉ねぎ OR ingredient contains 玉ねぎ)
```

英字についてはcase-insensitive検索とする。

検索結果は保存日時の新しい順とする。

### 10.3 Tag API

#### GET `/v1/tags`

ログインUserのTag一覧を返す。

並び順は `createdAt ASC` とする。

#### POST `/v1/tags`

Request：

```json
{
  "name": "作り置き"
}
```

Tag名はtrim後1〜30文字とする。

正規化後に同名Tagが既に存在する場合、新規重複Tagを作成せず既存Tagを返す。

#### POST `/v1/recipes/:recipeId/tags`

Request：

```json
{
  "tagId": "uuid"
}
```

RecipeへTagを付与する。

既に付与済みの場合もエラーにせず成功扱いにする。

#### DELETE `/v1/recipes/:recipeId/tags/:tagId`

RecipeからTagを解除する。

Tag master自体は削除しない。

MVPではTag master削除・名称変更APIを実装しない。

### 10.4 Setting API

#### GET `/v1/settings`

```json
{
  "recipeAnalysisNotificationEnabled": true
}
```

#### PATCH `/v1/settings`

```json
{
  "recipeAnalysisNotificationEnabled": false
}
```

### 10.5 Push Token API

#### PUT `/v1/device-token`

現在端末のFCM Tokenをupsertする。

```json
{
  "token": "fcm-token"
}
```

#### DELETE `/v1/device-token`

ログアウト時等に現在端末のTokenを削除する。

Request：

```json
{
  "token": "fcm-token"
}
```

### 10.6 Account API

#### DELETE `/v1/me`

アカウントを完全削除する。

詳細は「アカウント削除」で定義する。

---

## 11. API共通エラー形式

Backendの業務エラーは以下へ統一する。

```json
{
  "error": {
    "code": "DUPLICATE_RECIPE",
    "message": "Recipe already exists.",
    "details": {
      "recipeId": "uuid"
    },
    "requestId": "request-id"
  }
}
```

Backendの `message` をそのままユーザー表示しない。

iOS側は `code` をユーザー向け日本語メッセージへmappingする。

### 11.1 API Error Code

| HTTP | code | 用途 |
| ---: | --- | --- |
| 400 | INVALID_URL | URL形式不正 / http・https以外 |
| 400 | INVALID_REQUEST | request形式不正 |
| 401 | UNAUTHENTICATED | Firebase Token不正 / 期限切れ |
| 404 | NOT_FOUND | 対象resourceなし / 他User所有 |
| 409 | DUPLICATE_RECIPE | 正規化URL重複 |
| 422 | VALIDATION_ERROR | 編集値等の業務validation不正 |
| 500 | INTERNAL_ERROR | 想定外エラー |
| 503 | TEMPORARILY_UNAVAILABLE | 一時的なBackend障害 |

---

## 12. URL validation / 正規化

### 12.1 validation

保存可能URL：

```text
http://
https://
```

のみ。

以下は拒否する。

- ftp
- file
- data
- javascript
- custom scheme
- hostを持たないURL

URL長は最大4096文字とする。

### 12.2 共通正規化

ネットワークアクセスせず、入力URLだけから決定可能な正規化のみPOST `/recipes` 内で行う。

基本ルール：

1. schemeをlowercase
2. hostをlowercase
3. fragment (`#...`) を除去
4. default portを除去
5. 明確なtracking parameterを除去
6. 残ったquery parameterはkey/valueで安定sort
7. pathのcaseは変更しない
8. `www` を機械的に除去しない

tracking parameter例：

```text
utm_source
utm_medium
utm_campaign
utm_term
utm_content
utm_id
gclid
fbclid
```

### 12.3 サービス別正規化

#### YouTube

可能な場合、video IDを基準に以下へ正規化する。

```text
https://www.youtube.com/watch?v=<videoId>
```

`youtu.be/<id>` と `youtube.com/watch?v=<id>` は同一視する。

再生開始位置等のparameterは重複判定には使用しない。

#### Instagram

投稿 / Reelのcanonical pathを残し、共有・tracking queryを除去する。

#### TikTok

URL文字列だけからvideo IDを確実に取得できる場合はvideo IDベースで正規化する。

短縮URL等、redirect先取得が必要なURLについては保存APIで外部network requestを行わないため、完全な同一判定を保証しない。

### 12.4 MVP上の制限

即時保存を維持するため、重複判定のためだけに外部URLへnetwork requestは行わない。

したがって、短縮URLとcanonical URLのようにredirect解決が必要な別表現はMVPで重複を完全検出できない場合がある。

---

## 13. 任意URL取得のセキュリティ

foodfolioはユーザー入力URLをBackendから取得するため、SSRF対策を必須とする。

### 13.1 SafeHttpClient

URL取得処理は直接 `fetch(userUrl)` せず、必ず `SafeHttpClient` を経由する。

SafeHttpClientで最低限以下を実施する。

- http / https以外拒否
- localhost拒否
- loopback address拒否
- private network address拒否
- link-local address拒否
- multicast / reserved address拒否
- cloud metadata endpoint等の内部host拒否
- DNS解決結果を検証
- redirect先ごとに再検証
- redirect回数上限を設定
- response size上限を設定
- timeoutを設定
- CookieやUser credentialを送信しない

DNS検証後に別addressへ接続される実装を避けるため、単純な `dns.lookup()` pre-checkだけで完了させず、検証済みaddressへ接続する方式または同等の安全なHTTP client実装を使用する。

### 13.2 取得上限

初期値：

```text
HTTP timeout: 30秒
redirect: 最大5回
HTML/text response: 最大5MB
```

上限超過時は解析失敗として扱う。

---

## 14. URL情報取得

PoCで成立した方式を本番モジュールへ移植する。

共通処理：

- HTML
- OGP
- JSON-LD
- metadata

サービス別：

- YouTube: oEmbed + page内player情報
- Instagram: 公開OG metadata範囲
- TikTok: 公開oEmbed / HTML metadata範囲
- クラシル
- クックパッド
- 一般Web

認証回避、非公開コンテンツ取得、動画・画像本体の無断downloadは行わない。

### 14.1 SourceContent

Worker内部では概念上以下へ変換する。

```ts
interface SourceContent {
  sourceType: SourceType;
  sourceLabel: string;
  resolvedUrl: string;
  imageUrl: string | null;
  textForAi: string | null;
}
```

`textForAi` はAI呼び出し後に破棄し、DBへ保存しない。

### 14.2 画像取得失敗

画像取得失敗だけではAI解析失敗にしない。

```text
imageUrl = null
```

として処理継続する。

---

## 15. AI解析仕様

### 15.1 Provider / Model

MVP標準：

```text
Provider: Z.ai
Model: glm-5.3-flash
API: Chat Completions
Response format: JSON object
```

### 15.2 PoC設定を本番初期値とする

PoC合格時の設定を不用意に変更しない。

```text
AI request timeout: 120秒
max output tokens: 4000
stream: false
response_format: json_object
```

PoCではtemperature / top_p等を明示指定していないため、MVP本番でも追加指定しない。

これらのgeneration parameterを変更する場合は、既存fixtureで回帰確認してから変更する。

### 15.3 Prompt方針

PoCで使用した原則を維持する。

- 入力source textに存在する事実だけを抽出する
- genre以外を推測補完しない
- 不明な値はnull / empty array
- ingredient name / amountを忠実に保持
- servingsの原文を保持
- Recipe Schemaへ一致するJSONだけ返す

### 15.4 AI Schema

本番では `schemas/extracted-recipe.schema.json` を使用する。

概念型：

```ts
interface ExtractedRecipe {
  title: string | null;
  servings: {
    value: number | null;
    raw: string | null;
  } | null;
  cookingTimeMinutes: number | null;
  genre: Genre | null;
  ingredients: Array<{
    name: string;
    amount: string | null;
  }>;
  steps: string[];
}
```

処理：

```text
AI response
↓
JSON.parse
↓
Ajv validation
├─ valid -> DB mapping
└─ invalid -> retryable analysis error
```

### 15.5 範囲人数

`1〜2人分`、`2〜3 servings` 等、単一の基準人数を一意に決められない場合：

```text
servings.raw = 原文
servings.value = null
```

原文はUI表示可能とするが、人数変更UIは表示しない。

中央値・平均値等へ変換してはならない。

---

## 16. AI解析結果のDB反映

### 16.1 title

pending / processing中の初期値：

```text
解析中のレシピ
```

AI title取得成功時：

```text
titleUserEdited = false の場合のみAI値で更新
```

AI処理がcompletedだがtitleを取得できなかった場合：

```text
タイトル未取得のレシピ
```

AI解析がfailedで、ユーザー編集済みtitleもAI titleもない場合：

```text
解析に失敗したレシピ
```

### 16.2 genre

`genreUserEdited = false` の場合のみAI結果で更新する。

### 16.3 ingredients

`ingredientsUserEdited = false` の場合のみAI結果で全置換する。

MVPではAI再解析機能を持たないが、解析中にユーザー編集が発生した場合にも上書きしないためflagを持つ。

### 16.4 servings / cookingTime / steps

MVPではユーザー編集不可のため、AI成功時に更新する。

### 16.5 Tag

AIはTagを作成・付与しない。

---

## 17. 非同期解析フロー

### 17.1 保存からTask enqueue

```text
POST /v1/recipes
↓
Recipe INSERT (pending)
↓
Cloud Tasks enqueue(recipeId)
↓
API response
```

Task payload：

```json
{
  "recipeId": "uuid"
}
```

User IDはTask payloadの信頼情報として使用せず、WorkerがRecipeから取得する。

### 17.2 Worker endpoint

内部endpoint例：

```text
POST /internal/tasks/recipe-analysis
```

一般Clientから呼び出せないよう、Cloud TasksからのOIDC認証済みrequestのみ許可する。

### 17.3 Worker状態遷移

```text
pending
  ↓
processing
  ├─ success ----------------> completed
  ├─ permanent error --------> failed
  └─ retryable error
       ├─ attempts remaining -> pending -> Cloud Tasks retry
       └─ attempts exhausted -> failed
```

### 17.4 最大試行回数

Application側の最大解析試行回数：

```text
3回
```

`analysisAttemptCount` をDBで管理する。

Worker開始時に原子的にincrementする。

### 17.5 冪等性

Cloud Tasksは同一処理を複数回配送し得る前提でWorkerを冪等にする。

Worker受信時：

```text
completed -> 何もせず成功応答
failed -> 何もせず成功応答
pending / processing -> 処理対象
```

結果反映はtransaction内で現在statusと編集flagを再確認する。

同一Recipeに対して複数Taskが同時実行されないよう、statusのcompare-and-setまたはDB transactionによって処理権を取得する。

### 17.6 retryable error

例：

- 外部HTTP timeout
- 外部HTTP 429
- 外部HTTP 5xx
- Z.ai timeout
- Z.ai 429
- Z.ai 5xx
- JSON parse失敗
- Schema validation失敗
- 一時的DB / network障害

### 17.7 permanent error

例：

- source本文が取得不能
- private / login required page
- 対応不能なcontent
- 十分なAI入力textがない
- URL取得先が安全性検証に失敗

---

## 18. Analysis Error Code

Recipeに保存する内部error codeを以下とする。

```text
TASK_ENQUEUE_FAILED
SOURCE_FETCH_TIMEOUT
SOURCE_FETCH_FAILED
SOURCE_ACCESS_DENIED
SOURCE_CONTENT_UNAVAILABLE
SOURCE_UNSAFE_URL
AI_TIMEOUT
AI_RATE_LIMITED
AI_PROVIDER_ERROR
AI_INVALID_JSON
AI_SCHEMA_INVALID
INTERNAL_ANALYSIS_ERROR
```

Providerのraw error responseやsource本文はRecipeへ保存しない。

Cloud Loggingには `recipeId / requestId / providerRequestId / errorCode / latency / attempt` 等の診断情報だけを構造化loggingし、取得本文・API key・Firebase tokenを出力しない。

---

## 19. 検索仕様

### 19.1 対象

- Recipe.title
- Ingredient.name
- Genre
- Tag 1件

### 19.2 対象外

- cooking time
- servings
- steps
- source
- saved date filter
- natural language semantic search

### 19.3 検索履歴

検索ワード履歴はBackendへ保存しない。

iOSのlocal storageに以下だけ保存する。

```text
[String]
```

ルール：

- trim後の空文字は保存しない
- 最新順
- 最大10件
- 同一文字列は重複させず先頭へ移動
- 個別削除
- 全削除
- genre / tagは履歴に保存しない
- ログアウト時に削除する
- アカウント削除成功時に削除する

保存先は `UserDefaults` を基本とする。

---

## 20. 人数変更・分量比例計算

人数変更はiOS内の表示処理だけで行い、APIへ送信しない。

### 20.1 人数変更UI表示条件

以下をすべて満たす場合のみ表示する。

```text
servingsValue != null
servingsValue > 0
servingsValueが単一の明確な基準人数
```

`servingsRaw` が範囲表現等で `servingsValue = null` の場合は表示しない。

### 20.2 計算

```text
倍率 = 表示人数 / 基準人数
```

Ingredient.amountの数値部分が安全に解析できる場合だけ倍率を掛ける。

対象例：

```text
200g
大さじ2
1/2個
2.5本
```

対象外例：

```text
少々
適量
お好みで
ひとつまみ
```

解析不能なamountは原文表示する。

### 20.3 保存

以下は保存しない。

- 表示人数
- 計算後amount

詳細画面を開き直した場合は基準人数へ戻す。

---

## 21. Tag正規化

Tag作成時：

1. 前後空白trim
2. 連続する空白を1つへ正規化
3. Unicode NFKC正規化
4. ASCII alphabetはlowercaseした値を `normalizedName` とする
5. 表示用 `name` はユーザー入力の見た目を可能な範囲で維持する

例：

```text
" 作り置き " -> normalizedName = "作り置き"
"QUICK" -> normalizedName = "quick"
"Quick" -> normalizedName = "quick"
```

同一User内で `normalizedName` が同一なら同じTagとして扱う。

---

## 22. Push Notification

### 22.1 アプリ内設定

初期値：

```text
recipeAnalysisNotificationEnabled = true
```

通知対象：

- completed
- failed

### 22.2 iOS通知許可要求

初回ログイン完了直後：

```text
Firebase Auth success
↓
Recipe一覧へ遷移
↓
OS通知authorization status確認
↓
notDeterminedの場合 requestAuthorization
```

OS側で拒否された場合もBackendの通知設定は `true` のまま維持する。

### 22.3 OS通知拒否時の設定画面

アプリ設定ONかつOS通知無効の場合：

```text
レシピ解析通知: ON
通知はiOS設定で無効になっています
[設定を開く]
```

OS Settingsへの導線を表示する。

### 22.4 FCM Token登録

通知権限が利用可能でTokenを取得できた場合：

```text
PUT /v1/device-token
```

Token refresh時も同APIを呼ぶ。

アプリ内通知設定をOFFにしてもToken自体は保持し、BackendのUserSettingで送信を抑止する。

### 22.5 通知送信

Workerがcompleted / failedへ遷移した後：

```text
UserSetting.recipeAnalysisNotificationEnabled
├─ false -> sendしない
└─ true
    ↓
DeviceToken取得
    ↓
FCM送信
```

送信失敗はRecipe解析結果をfailedへ戻さない。

無効Tokenと判定された場合は該当DeviceTokenを削除する。

### 22.6 Payload

通知payloadには最低限以下を含める。

```text
recipeId
analysisResult = completed | failed
```

通知tap時はログイン済みであれば該当Recipe詳細を開く。

未ログインの場合は認証完了後に可能なら該当Recipeへ遷移する。

---

## 23. アカウント削除

### 23.1 対象

以下を完全削除する。

- Firebase Authentication User
- User
- UserSetting
- Recipe
- Ingredient
- RecipeStep
- Tag
- RecipeTag
- DeviceToken
- その他User FK配下のデータ

検索履歴等のiOS local dataも削除する。

### 23.2 Backend処理

外部認証基盤とPostgreSQLを単一transactionにはできないため、MVPではprivacy上の残存を最小化するため次の順序とする。

```text
認証済みUser確認
↓
DB内User配下データをtransactionで完全削除
↓
Firebase AdminでFirebase User削除
↓
両方成功した場合のみ204
```

DB削除後にFirebase削除が失敗した場合：

- APIは成功扱いにしない
- DBデータは復元しない
- retry可能なエラーとしてClientへ返す
- 再試行時にFirebase UIDを基準にFirebase User削除を再実行できるようにする

アカウント削除endpointではUser DB recordが既にないケースでもFirebase User削除を試行できるようにする。

### 23.3 iOS側

204成功後：

- Firebase local sessionをsign out
- 検索履歴削除
- local cache削除
- navigation state初期化
- 認証画面へ戻る

---

## 24. Recipe削除と解析Taskの競合

Recipe削除時、既にCloud Tasksが存在する可能性がある。

MVPではTaskを個別cancelすることを必須としない。

WorkerがTaskを受信してRecipeが存在しない場合：

```text
成功応答して何もしない
```

これにより削除済みRecipeを復活させない。

---

## 25. iOSアーキテクチャ

### 25.1 基本方針

SwiftUI + Swift Concurrencyを基本とする。

Feature単位のMVVM相当構成とし、巨大なglobal ViewModelを作らない。

```text
View
↓
Feature ViewModel
↓
Repository / Service
↓
APIClient / Firebase SDK / Local Store
```

### 25.2 iOSディレクトリ

```text
ios/Foodfolio/
├─ App/
│  ├─ FoodfolioApp.swift
│  ├─ AppSession.swift
│  └─ AppRouter.swift
│
├─ Core/
│  ├─ API/
│  │  ├─ APIClient.swift
│  │  ├─ APIError.swift
│  │  └─ DTO/
│  ├─ Auth/
│  │  └─ AuthService.swift
│  ├─ Notifications/
│  │  └─ NotificationService.swift
│  ├─ Persistence/
│  │  └─ SearchHistoryStore.swift
│  ├─ Models/
│  └─ UI/
│
├─ Features/
│  ├─ Auth/
│  ├─ RecipeList/
│  ├─ AddRecipe/
│  ├─ RecipeSearch/
│  ├─ RecipeDetail/
│  ├─ RecipeEdit/
│  ├─ Settings/
│  └─ Account/
│
└─ Resources/
```

### 25.3 Navigation

`AppRouter` は以下のアプリ全体navigationのみ管理する。

- 認証状態
- Recipe detailへのnavigation
- DrawerからSettings / Accountへのnavigation
- Push notificationからRecipe detailへのdeep link

Sheet / Dropdown等の局所UI stateはFeature側で持つ。

### 25.4 APIClient

`APIClient` の責務：

- Firebase ID Token取得
- Authorization header付与
- JSON encode/decode
- HTTP status判定
- API error decode
- request ID取得

Feature Viewから直接URLSessionを呼ばない。

### 25.5 DTOとUI Model

Backend DTOをSwiftUI Viewへ直接渡さず、必要に応じてDomain/UI modelへ変換する。

ただしMVPでは不要なRepository層の増殖を避け、単純FeatureではAPI serviceからViewModelへ直接DTOを返してよい。

---

## 26. iOS画面別実装責務

### SCR-01 認証

- Firebase Auth
- Apple / Google / Email
- login / signup / password reset
- 認証完了後AppSession更新
- 初回通知許可要求

### SCR-02 レシピ一覧

- `GET /v1/recipes`
- 2列grid
- pagination
- pull-to-refresh
- placeholder image
- pending / processing title表示
- FAB
- Drawer

解析完了のリアルタイムpush更新専用socket等は導入しない。

画面再表示、pull-to-refresh、通知tap等で再取得する。

アプリforeground復帰時、一覧表示中であれば先頭pageを再取得してよい。

### SCR-03 URL追加Sheet

- URL入力
- local format check
- `POST /v1/recipes`
- 201でSheet close
- 409で既存Recipeへの導線
- AI完了は待たない

### SCR-04 レシピ検索

- query入力
- genre 1件
- tag 1件
- local検索履歴
- debounceしてsearch API実行
- queryなし + filterありを許可

### SCR-05 レシピ詳細

- Recipe detail取得
- servings表示
- 分量比例計算
- Tag追加Bottom Sheet
- 元URL open
- edit navigation
- delete
- analysis error表示

### SCR-06 レシピ編集

- title
- ingredients
- genre
- tags
- save時PATCH

### SCR-07 設定

- Backend notification setting
- OS notification authorization state
- OS Settingsへの導線

### SCR-08 アカウント

- Firebase user info表示
- provider表示
- logout
- account delete

---

## 27. iOS状態管理

### 27.1 AppSession

アプリ全体で共有する状態は最小限とする。

```text
authState
currentFirebaseUser
pendingDeepLinkRecipeId
```

Recipe一覧や検索結果をglobal storeとして共有しない。

### 27.2 Loading / Error

各Feature ViewModelは概念上以下を持つ。

```text
idle
loading
loaded
error
```

保存・編集等のmutationは画面全体の状態と分離して `isSubmitting` 等で管理してよい。

---

## 28. 一覧・検索のページネーション

cursor based paginationを採用する。

cursorには概念上以下を含める。

```text
createdAt
id
```

Clientからcursor内部構造へ依存させず、opaque stringとして返す。

初期page：30件。

最大：50件。

---

## 29. データ整合性・競合制御

### 29.1 URL重複

事前SELECTだけに依存せずDBの以下のunique constraintを最終防衛線とする。

```text
UNIQUE(userId, normalizedUrl)
```

同時requestによる競合でも重複Recipeを作成しない。

### 29.2 Tag重複

```text
UNIQUE(userId, normalizedName)
```

を最終防衛線とする。

### 29.3 AI更新とユーザー編集

Worker最終更新transactionで `titleUserEdited / genreUserEdited / ingredientsUserEdited` を再取得してからAI値を反映する。

Worker開始時に読み込んだ古いflagだけで判断しない。

---

## 30. Logging / Observability

Backendは構造化logを使用する。

主要field：

```text
requestId
userId
recipeId
analysisStatus
analysisAttempt
errorCode
provider
model
providerRequestId
latencyMs
inputTokens
outputTokens
```

禁止：

- Firebase ID Token
- Z.ai API Key
- DB password
- source本文全文
- AI raw response全文
- private credential

Crashlytics / Analyticsのイベント詳細はTestFlightリリース準備工程で定義する。

---

## 31. Secrets / Environment Variables

主要environment variable：

```text
APP_ENV
DATABASE_URL
DATABASE_DIRECT_URL
GCP_PROJECT_ID
CLOUD_TASKS_LOCATION
CLOUD_TASKS_QUEUE
WORKER_URL
ZAI_API_KEY
AI_MODEL=glm-5.3-flash
MAX_ANALYSIS_ATTEMPTS=3
```

API Key / DB接続情報はSecret ManagerからCloud Runへ渡す。

Firebase Admin / Cloud Tasks等のGCP認証にはCloud Run Service AccountのApplication Default Credentialsを基本とし、Service Account JSON key fileを配布しない。

---

## 32. Docker / Deploy

APIとWorkerは同一Docker imageを使用する。

entrypointだけ変える。

```text
foodfolio-api
  node dist/entrypoints/api.js

foodfolio-worker
  node dist/entrypoints/worker.js
```

同一commitから同一imageをdeployすることで、Domain / Schema差分を防ぐ。

---

## 33. テスト方針

### 33.1 Unit Test

最低限：

- URL validation
- URL normalization
- source classification
- Tag normalization
- search query組み立て
- cursor encode / decode
- amount比例計算
- range servings判定
- analysis state transition
- retry判定
- AI Schema validation
- AI result → DB mapping
- API error mapping
- SearchHistoryStore

### 33.2 Integration Test

最低限：

- Prisma CRUD
- URL unique constraint
- Tag unique constraint
- RecipeTag ownership validation
- Recipe search query
- Recipe delete cascade
- account DB cascade delete
- API route + fake auth adapter
- Worker + fake URL extractor + fake AI adapter + test DB
- AI結果とユーザー編集競合

PostgreSQL固有挙動を確認するため、DB integration testはSQLiteへ置き換えずPostgreSQLで行う。

### 33.3 E2E

既存PoCの外部URL / Z.ai E2Eは実APIを使うため通常の全commit CIから分離する。

通常CI：

```text
外部ProviderをstubしたApplication E2E
```

手動 / 必要時：

```text
poc:url
poc:ai:zai
poc:e2e
```

### 33.4 iOS Test

最低限：

- URL追加ViewModel
- SearchHistoryStore
- Search query state
- servings amount scaling
- API error → UI message mapping
- notification setting表示判定

UI automationはMVPの主要flowに限定する。

---

## 34. CI

Pull Request / main pushで最低限以下を実行する。

```text
npm test
npm run lint
npm run format:check
npm run build
```

Backend実装後は追加：

```text
Prisma schema validation
PostgreSQL integration tests
```

外部AI APIを呼ぶテストは通常CIでは実行しない。

---

## 35. 実装順序

### Phase 1: Backend / DB基盤

1. 本番directory作成
2. Fastify API / Worker entrypoint
3. Prisma Schema
4. Neon接続
5. Firebase token verification
6. User / UserSetting同期
7. error / logging基盤

### Phase 2: Recipe保存・一覧

1. URL validation / normalization
2. POST `/recipes`
3. GET `/recipes`
4. GET `/recipes/:id`
5. iOS Recipe一覧
6. URL追加Sheet

この時点ではAIなしでも保存・一覧・詳細が成立する状態にする。

### Phase 3: Worker / AI

1. Cloud Tasks enqueue
2. Worker OIDC endpoint
3. PoC URL extractor移植
4. SafeHttpClient / SSRF対策
5. Schema共通化
6. Z.ai adapter移植
7. analysis state transition
8. DB更新

### Phase 4: 詳細・編集・Tag

1. Recipe詳細
2. PATCH Recipe
3. Recipe削除
4. Tag作成
5. Tag付与 / 解除
6. servings比例表示

### Phase 5: Search

1. PostgreSQL検索query
2. search API
3. iOS検索画面
4. UserDefaults検索履歴

### Phase 6: Notification

1. FCM / APNs設定
2. DeviceToken API
3. 初回ログイン後permission request
4. completed / failed通知
5. Settings表示
6. Push deep link

### Phase 7: Account

1. account画面
2. logout時Token削除
3. account完全削除
4. local data cleanup

### Phase 8: 実環境検証

技術選定書で後続検証として残っている以下を実環境で確認する。

- Cloud Tasks → Cloud Run Worker
- Cloud Run → Neon pooled connection
- Prisma migration
- Apple / Google / Email Firebase Authentication
- Password reset
- FCM → APNs実機通知
- Singapore構成の実機体感latency
- 実運用コスト

---

## 36. PoCコードの扱い

既存 `poc/` は技術検証証拠として残す。

本番コードから `poc/` moduleを直接importしない。

移植対象：

- URL source classification
- URL metadata / content extraction
- Z.ai request処理
- SYSTEM_PROMPTの原則
- Recipe Schema
- AI response parse / validation

移植後もPoCを回帰確認用として維持する。

---

## 37. PoC番号の整理

既存資料では「PoC 3」が以下2用途で使用されている。

- 実URL E2E
- Cloud Tasks → Cloud Run Worker非同期処理

実装時は番号ではなく名称で扱う。

本書では以下のように区別する。

```text
完了済み:
- URL取得PoC
- AI構造化抽出PoC
- 実URL E2E PoC

後続実環境検証:
- Cloud Tasks / Worker検証
- Neon接続検証
- Authentication検証
- Push Notification検証
```

---

## 38. MVPで実装しないもの

本実装設計でも以下は対象外とする。

- URLなし自作Recipe作成
- iOS Share Extension
- Tag master rename
- Tag master delete
- Tag複数選択検索
- Tag AND / OR切替
- Recipe一括Tag操作
- AI Tag生成
- AI手動再解析
- AI Provider自動fallback
- 画像専用Storage
- 調理時間検索
- semantic / vector search
- WebSocket / realtime DB同期
- sort変更UI
- soft delete / trash
- 課金
- 保存件数制限

---

## 39. 実装設計完了条件

以下について実装者が追加の大きな設計判断をせず着手できれば、本工程を完了とする。

- Repository構造
- DB entity / relation
- Prisma migration方針
- Firebase認証境界
- Recipe / Tag / Setting / DeviceToken API
- URL重複判定
- SSRF対策
- Recipe検索条件
- 検索履歴保存場所
- AI Schema
- Z.ai初期parameter
- AI結果のDB反映
- AnalysisStatus / retry / idempotency
- Notification permission / setting
- Account deletion
- iOS Feature構造
- Error code
- Test境界
- 実装順序

本書をもってMVPの実装設計を完了し、次工程は **実装 + テスト** とする。
