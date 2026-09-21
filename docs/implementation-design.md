# foodfolio MVP 実装設計書

## 1. 本書の目的

本書は、foodfolio MVPの実装時にデータ構造・API・iOS構成・iOSローカル永続化・同期・Backend構成・非同期処理・検索・通知・エラー処理について大きく迷わない状態を作ることを目的とする。

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

| 項目                    | 決定                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| タグ検索                | 1タグのみ選択可能                                                                                             |
| URL重複                 | 明らかな差異を正規化して同一URL判定                                                                           |
| 検索履歴                | iPhone端末内に保存                                                                                            |
| `1〜2人分` 等の範囲人数 | 原文は表示するが人数変更・比例計算は行わない                                                                  |
| レシピ解析通知          | 初期ON                                                                                                        |
| 通知許可要求            | 初回ログイン完了直後に要求                                                                                    |
| OS通知拒否時            | アプリ内通知設定はONを維持し、OS設定が無効であることを表示                                                    |
| アカウント削除          | 関連ユーザーデータを即時完全削除                                                                              |
| オフライン利用          | 保存済みレシピの閲覧・検索のみ可能                                                                            |
| iOSローカルDB           | SwiftDataへRecipe等のローカルコピーを永続保存                                                                 |
| 画像保存                | Application Supportへ保存し、同一端末でアプリが存在する間は原則保持                                           |
| 画像URL失効             | ローカル画像と保存済みimageUrlが利用不可ならoriginalUrlから端末側で再取得し、それも失敗したらプレースホルダー |
| AI解析中編集            | pending / processing中は不可                                                                                  |
| 解析失敗表示            | 原因別表示をせず共通メッセージ                                                                                |
| レシピ検索              | SwiftData上でローカル検索                                                                                     |
| 同期                    | Backend発行cursorによる差分同期                                                                               |
| 複数端末                | リアルタイム整合は保証せず、定期的な全Recipe ID照合で削除を検出                                               |

### 2.2 MVPの実装原則

- iOSとBackendを同一GitHubリポジトリで管理する。
- BackendはNode.js + TypeScriptの単一コードベースとし、APIとWorkerを別entrypoint・別Cloud Run Serviceとして起動する。
- APIとWorkerのためにマイクロサービスを細分化しない。
- Firebase AuthenticationのFirebase UIDを認証上の外部ユーザー識別子とする。
- アプリケーションDBでは独自のUUIDを主キーとして使用する。
- Neon PostgreSQLをユーザーデータの正本（Source of Truth）とする。
- SwiftDataは一覧・詳細・検索・オフライン閲覧用のローカルコピーとする。
- URL追加・編集・タグ変更・削除はオンライン必須とし、オフラインmutation queueは作らない。
- API mutation成功後はレスポンスをSwiftDataへ即時反映する。
- 通常同期はBackend発行cursorによる差分同期とし、Client端末時刻を同期基準にしない。
- hard delete検出のため、定期的にServerとLocalのRecipe IDを全件照合する。
- AI解析はURL保存APIと分離し、Cloud Tasks経由で非同期実行する。
- AI解析中でもRecipeの閲覧は可能とするが、pending / processing中の編集は不可とする。
- 画像バイナリはDBへ保存せず、iOSのApplication Supportへ保存する。
- 外部URLから取得した本文そのものやAIのraw responseはDBへ永続保存しない。
- PoCコードをそのまま本番entrypointとして使用せず、検証済みロジックを本番モジュールへ移植する。
- MVPでは不要な抽象化・汎用化を増やさない。ただしAI Provider、URL取得、通知、認証、DBは外部依存境界としてAdapter化する。

---

## 3. 採用アーキテクチャ

```text
┌─────────────────────────────┐
│ iOS App                     │
│ Swift / SwiftUI / iOS 26+   │
│                             │
│ SwiftData                   │
│ Application Support         │
└──────────────┬──────────────┘
               │ Firebase ID Token
               │ sync / mutation
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
│ Source of     │  └────────┬────────┘
│ Truth         │           │ OIDC authenticated HTTP
└───────────────┘           ▼
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
- 解析受付上限制御
- Tag CRUDのMVP範囲
- RecipeTag付与 / 解除
- 差分同期
- Recipe ID全件照合
- UserSetting取得 / 更新
- FCM Token登録 / 削除
- アカウント削除
- Cloud Tasks enqueue

MVPではRecipe検索APIを実装せず、検索はiOSのSwiftDataで行う。

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
- AnalysisAdmission ID: UUID
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

アカウント画面のemailはiOS側のFirebase User情報から取得する。

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
- title: string NOT NULL DEFAULT "解析中のレシピ"
- imageUrl: text NULL
- servingsValue: float NULL
- servingsRaw: string NULL
- cookingTimeMinutes: integer NULL
- genre: enum NULL
- analysisStatus: enum NOT NULL DEFAULT pending
- analysisProvider: enum(zai, gemini) NULL
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
INDEX(userId, updatedAt)
```

`updatedAt` は差分同期の変更検知に使用する。Recipe本体だけでなく、Ingredient変更、RecipeTag付与・解除、AI解析結果反映時にも親Recipeの `updatedAt` を必ず更新する。

### 7.4 SourceType

```text
youtube
instagram
tiktok
kurashiru
cookpad
web
```

UI表示用の元サービス / ドメイン文字列はDBへ `sourceLabel` として重複保存せず、`sourceType` と `originalUrl` から生成する。

例：

```text
youtube  -> YouTube
instagram -> Instagram
web -> originalUrlのdomain
```

### 7.5 AnalysisStatus

正式な内部statusは以下に確定する。

```text
pending
processing
completed
failed
not_recipe
```

`partial` は独立statusにしない。

一部項目が取得できなくても解析処理そのものが正常終了した場合は `completed` とする。

`not_recipe` は技術的な解析失敗ではなく、semantic gateが1つの具体的なレシピではないと正常判定したterminal stateとする。Recipeは削除せず、通常編集不可・元URL閲覧可・削除可とする。

### 7.6 Ingredient

```text
Ingredient
- id: UUID PK
- recipeId: UUID FK -> Recipe.id ON DELETE CASCADE
- name: string NOT NULL
- amount: string NULL
- sortOrder: integer NOT NULL
```

MVPでは分量を数値・単位へ完全分解してDB保存しない。

原典表現を保持するため `amount` は文字列とする。

Ingredient更新時は親Recipeの `updatedAt` も更新する。

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

PRIMARY KEY(recipeId, tagId)
```

RecipeとTagが同一Userに属することはApplication層で必ず検証する。

RecipeTag付与・解除時は親Recipeの `updatedAt` も更新する。

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

### 7.11 AnalysisAdmission

解析依頼の受付履歴をRecipeとは独立して保持する。

```text
AnalysisAdmission
- id: UUID PK
- userId: UUID FK -> User.id ON DELETE CASCADE
- recipeId: UUID UNIQUE NOT NULL
- acceptedAt: datetime NOT NULL
- finishedAt: datetime NULL
```

`acceptedAt` はユーザー日次・月次およびシステム全体日次の受付上限に使用する。`finishedAt = null` の行は未処理上限として数える。

`recipeId` は意図的にRecipeへの外部キーにしない。解析中Recipeを削除しても既に受け付けた解析依頼の履歴を失わず、削除による上限回避を防ぐためである。

初回rolloutでは既存Recipeをbackfillせず、`AnalysisAdmission` テーブル作成後に受け付けた解析依頼から集計を開始する。デプロイ以前に実行・完了した解析は初回rollout月の日次・月次受付数に含めない。この例外は初回rollout時だけとし、以後は保存された `AnalysisAdmission` をJSTの日次・月次境界で集計する。

詳細な受付上限・JST境界・解放条件は [analysis-admission-control.md](analysis-admission-control.md) を参照する。

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

ただし `DELETE /v1/me` はアカウント削除の部分失敗後も安全に再試行できる必要があるため、この自動作成を行わない。DBのUserが既に削除済みでもFirebase UIDを保持したままアカウント削除処理を続行する。

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
DB transaction開始 + PostgreSQL transaction-level advisory lock取得
↓
ユーザー未処理 < 10
↓
ユーザー当日受付 < 30（JST）
↓
ユーザー当月受付 < 100（JST）
↓
システム全体未処理 < 100
↓
システム全体当日受付 < 500（JST）
↓
Recipe + AnalysisAdmission保存
  title = 解析中のレシピ
  analysisStatus = pending
↓
commit
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

受付上限到達時：

```http
429 Too Many Requests
```

`ANALYSIS_LIMIT_EXCEEDED` と `limitType / limit / retryAt` を返し、iOSは上限種別に応じた日本語メッセージを表示する。時間で解消する日次・月次上限では `retryAt` を返す。

Cloud Tasks enqueueに失敗した場合もRecipe自体は削除しない。

その場合：

```text
analysisStatus = failed
```

としてRecipeを返し、内部原因 `TASK_ENQUEUE_FAILED` はCloud Loggingへ記録する。未処理枠は解放するが、日次・月次の受付履歴は維持する。

201成功レスポンスはiOS側でSwiftDataへ即時反映する。

#### GET `/v1/recipes`

Recipe一覧の全件照合・デバッグ・必要時の通常取得に利用する。

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

iOSの通常画面表示はこのAPIの応答待ちにせず、SwiftDataを先に表示する。

#### GET `/v1/recipes/:recipeId`

Recipe詳細取得。

Responseに含める主な項目：

- id
- originalUrl
- sourceType
- title
- imageUrl
- servingsValue
- servingsRaw
- cookingTimeMinutes
- genre
- analysisStatus
- ingredients
- steps
- tags
- createdAt
- updatedAt

元サービス / ドメインの表示文字列はiOS側で `sourceType` と `originalUrl` から生成する。

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

`analysisStatus` が `pending` または `processing` のRecipeは編集不可とし、Backendでも `RECIPE_ANALYSIS_IN_PROGRESS` として拒否する。

画像、人数、調理時間、手順、URL、解析状態はこのAPIから変更不可とする。

更新成功時はRecipeの `updatedAt` を更新し、更新後のRecipe DTOを返す。iOSはレスポンスをSwiftDataへ即時反映する。

#### DELETE `/v1/recipes/:recipeId`

Recipeを完全削除する。

Ingredient、RecipeStep、RecipeTagはcascade deleteする。

成功：

```http
204 No Content
```

iOSは成功後、該当LocalRecipeとローカル画像を削除する。

### 10.2 Sync API

#### GET `/v1/sync`

SwiftDataのローカルコピーをBackend DBへ追従させるための差分同期API。

Query：

```text
cursor: optional
```

初回同期では `cursor` を送らず、現在のRecipe詳細データとTagを返す。

2回目以降は前回Backendが返したopaque cursorを送る。

```text
GET /v1/sync?cursor=<opaque-cursor>
```

Backendはrequest開始時にDB基準のhigh-water markを確定し、前回cursorより後かつ今回high-water mark以下に変更されたRecipeを返す。Client端末時刻は同期判定に使用しない。

Recipeの差分判定には `Recipe.updatedAt` を使用する。Ingredient変更、RecipeTag付与・解除、AI解析結果反映でも親Recipeの `updatedAt` を更新するため、関連データ変更をRecipe単位で取得できる。

Response概念：

```json
{
  "recipes": [
    {
      "id": "uuid",
      "originalUrl": "https://...",
      "sourceType": "web",
      "title": "親子丼",
      "imageUrl": "https://...",
      "servingsValue": 2,
      "servingsRaw": "2人分",
      "cookingTimeMinutes": 20,
      "genre": "主菜",
      "analysisStatus": "completed",
      "ingredients": [],
      "steps": [],
      "tags": [],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "tags": [],
  "nextCursor": "opaque-cursor"
}
```

同期処理が成功してSwiftDataへの反映まで完了した後にのみ、iOS側で `nextCursor` を保存する。

MVPではRecipe hard deleteを差分レスポンスへtombstoneとして含めない。

#### GET `/v1/sync/recipe-ids`

ログインUserが現在保持しているRecipe IDを全件返す。

用途はhard deleteの定期reconciliationのみとする。

```json
{
  "recipeIds": ["uuid-1", "uuid-2"]
}
```

iOSは最終全件照合から24時間以上経過し、オンライン状態で同期可能な場合にこのAPIを利用する。

```text
Server Recipe IDs
        ↕
Local Recipe IDs
↓
Serverに存在しないLocalRecipeを削除
↓
該当ローカル画像も削除
```

複数端末間のリアルタイム整合性はMVPでは保証しない。

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

付与時は親Recipeの `updatedAt` を更新し、成功レスポンスをiOS側のSwiftDataへ反映する。

#### DELETE `/v1/recipes/:recipeId/tags/:tagId`

RecipeからTagを解除する。

Tag master自体は削除しない。

解除時は親Recipeの `updatedAt` を更新する。

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

Firebase Userに `apple.com` providerが含まれる場合、iOSはこのAPIを呼ぶ前にSign in with Appleのauthorization codeを再取得し、Firebase Auth SDKでApple token revokeを完了させる。

Appleのauthorization codeはBackendへ送信しない。

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

| HTTP | code                        | 用途                                                            |
| ---: | --------------------------- | --------------------------------------------------------------- |
|  400 | INVALID_URL                 | URL形式不正 / http・https以外                                   |
|  400 | INVALID_REQUEST             | request形式不正                                                 |
|  401 | UNAUTHENTICATED             | Firebase Token不正 / 期限切れ                                   |
|  404 | NOT_FOUND                   | 対象resourceなし / 他User所有                                   |
|  409 | DUPLICATE_RECIPE            | 正規化URL重複                                                   |
|  409 | RECIPE_ANALYSIS_IN_PROGRESS | pending / processing中のRecipe編集                              |
|  422 | VALIDATION_ERROR            | 編集値等の業務validation不正                                    |
|  429 | ANALYSIS_LIMIT_EXCEEDED     | 解析受付上限（ユーザー未処理 / 日次 / 月次、全体未処理 / 日次） |
|  500 | INTERNAL_ERROR              | 想定外エラー                                                    |
|  503 | TEMPORARILY_UNAVAILABLE     | 一時的なBackend障害                                             |

`ANALYSIS_LIMIT_EXCEEDED` の `details` には `limitType` と数値の `limit` を含める。日次・月次のように時刻で解消する上限では、次回受付可能時刻をISO 8601の `retryAt` として含める。日次・月次境界はJSTを基準とする。

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

PoCで成立した方式を本番モジュールへ移植する。ただしYouTubeについては、技術選定で確定した公式API経路を使用し、旧PoCのHTML依存方式は本番へ移植しない。

共通処理：

- HTML
- OGP
- JSON-LD
- metadata

サービス別：

- YouTube: URLからvideoId抽出 → YouTube Data API v3 `videos.list(part=snippet)` → `title` / `description` / `thumbnails` 取得
- Instagram: 公開OG metadataを第一経路とし、本文だけではレシピ情報が不足する場合は、ユーザーがFoodfolioへ共有して解析を依頼した公開投稿に限って`yt-dlp`によるmedia fallbackを使用する。画像・動画を区別して投稿内の順序を保持し、一部entryの取得失敗は投稿全体の取得失敗として扱う
- TikTok: 公開oEmbed metadata。タイトル解析で材料または手順が得られない場合のみ、許可条件を満たした環境で動画フォールバック
- クラシル
- クックパッド
- 一般Web

YouTubeではページHTML、`ytInitialPlayerResponse`、oEmbedを説明文取得の主経路として使用しない。YouTube Data API呼び出しに必要な `YOUTUBE_API_KEY` はBackendのSecretとしてGoogle Cloud Secret Managerで管理し、Cloud Run Workerへ環境変数として渡す。

認証回避や非公開コンテンツ取得は行わない。Instagram media fallbackは、ユーザーがFoodfolioへ共有して解析を依頼した公開投稿だけを対象とし、取得したメディアをAI解析のために一時利用して通常完了時は即時削除する。TikTok動画フォールバックは書面許可を確認した環境だけで有効化する。dev環境は書面許可を確認済みのため有効とする。

### 14.1 YouTube説明欄優先・動画フォールバック

YouTube Data APIで取得した説明欄は、まず外部AIを使わない純粋関数で十分性を判定する。「十分」は、対象料理の範囲に分量表現を伴う材料行が2件以上あり、かつ調理動作を伴う工程行が2件以上ある場合に限定する。空、概要だけ、材料だけ、工程だけ、リンク・宣伝中心、本文だけでは工程を確認できない動画参照、または区切りを確実に判定できない説明欄は不十分とする。判定不能は十分側へ倒さない。

Jev本番導入後は、十分な説明欄だけをsemantic routing対象とする。

```text
YouTube Data API title / description
↓
説明欄の決定論的十分性判定
├─ 不十分・判定不能
│  ├─ YOUTUBE_GEMINI_FALLBACK_ENABLED=false → 解析失敗
│  └─ true → Jevを呼ばずGemini video route
└─ 十分
   ↓
   Jev
   ├─ p(recipe) >= source threshold
   │  → Z.ai text extraction
   │     ├─ ingredients・steps非空 → 保存
   │     └─ 不足
   │        ├─ YOUTUBE_GEMINI_FALLBACK_ENABLED=false → 解析失敗
   │        └─ true → Gemini video fallback
   └─ threshold未満
      ├─ YOUTUBE_GEMINI_FALLBACK_ENABLED=false → 解析失敗
      └─ true → Gemini video route
```

Jevの低いrecipe probabilityだけを理由にYouTubeを `not_recipe` にしない。説明欄にレシピがなくても動画内に存在する可能性があるためである。Jev自身が失敗した場合は即fail-openし、Jev導入前のYouTube routeへ戻る。

Gemini出力は、説明欄材料一覧由来と手順・動画だけに登場する材料を分け、各材料に名前、分量原文、短い使用根拠、根拠元を持つ中間Schemaとする。決定論的後処理で両配列を統合し、使用根拠があり分量未記載なら`適量`にする。説明欄と動画の矛盾は説明欄を優先し、一般知識から材料・数値を補わない。`4人分`は`servings.value=4`、`8個分`等の個数は`servings.raw`だけを保存し、材料個数は出来上がり量へ転用しない。

説明欄と動画内の命令は信頼しない。API key、Authorization header、説明欄全文、生のGemini responseを通常ログへ出さない。Gemini呼び出しは1レシピにつき1回に固定し、timeout、HTTP 429、HTTP 5xxを含む失敗でも再試行しない。これらは`retryable=false`の解析失敗として記録し、Workerは成功応答を返してCloud Tasksの再配送を終了する。

Jevを含むsource別routingの正本は [jev-production-routing.md](jev-production-routing.md) とする。

### 14.2 TikTokメディア解析

Jev本番導入後は動画・写真ともcaption / titleがある場合にsemantic routingを行う。

```text
TikTok URL
├─ /video/
│  └─ oEmbed title
│     ├─ textなし → video route
│     └─ textあり → Jev
│        ├─ p(recipe) >= source threshold
│        │  → Z.ai text extraction
│        │     ├─ ingredients・steps非空 → 保存
│        │     └─ 不足 → video fallback
│        └─ threshold未満 → video route
└─ /photo/
   └─ 公開メタデータから投稿文と画像URLを取得
      ├─ captionなし → photo media route
      └─ captionあり → Jev
         ├─ p(recipe) >= source threshold
         │  → Z.ai text extraction
         │     ├─ ingredients・steps非空 → 保存
         │     └─ 不足 → photo media fallback
         └─ threshold未満 → photo media route
```

Jevがtext routeを選んでも `ingredients > 0 AND steps > 0` を満たさない場合は必ずmediaへ戻る。JevだけでTikTokを `not_recipe` にしない。Jev自身が失敗した場合は即fail-openし、動画は従来のtext-first route、写真は従来のphoto media routeへ戻る。動画・写真のmedia routeは引き続き `TIKTOK_MEDIA_ANALYSIS_ENABLED` と既存の利用許可条件に従い、無効時にJevがmedia取得を強制有効化してはならない。

- `yt-dlp`は`2026.08.19`へ固定し、実行ファイルのSHA-256をDocker build時に検証する
- 動画取得は初回を含めて最大5回。5回すべて失敗した場合は非リトライ可能とし、Cloud Tasksで同じ取得を繰り返さない
- 1試行のtimeoutは45秒、待機は2秒、4秒、6秒、8秒とする
- MP4は100MBを上限とし、非公開GCS bucketへ一時uploadする
- Z.aiには有効期限10分のV4署名URLを`video_url`として渡す
- AI処理終了後はGCS objectとWorker一時ファイルを削除し、異常終了時もbucket lifecycleで1日後に削除する。動画を保持し続けないよう、この専用bucketのsoft deleteは無効化する
- 動画、署名URL、yt-dlpの生出力は通常ログへ記録しない
- テストは自作または利用許可済み動画を使用する
- 写真投稿はoEmbedを通さず、`/photo/<postId>`を主経路として処理する。captionがthreshold以上の場合のみtext extractionを先行し、不完全なら画像解析へfallbackする
- 写真投稿は元の順序の先頭10枚だけを試行し、一部の取得または一時公開に失敗しても、1枚以上成功すれば成功分を連番へ詰めて解析を続ける
- photo media routeではZ.aiへ投稿文・ハッシュタグと取得成功画像だけを渡す。画像を主根拠、投稿文を補助情報とし、コメント、投稿者プロフィール、楽曲情報は渡さない
- 写真の代表画像は一時署名URLではなく、先頭の取得元画像URLとする。`image/resolve`でも同じ公開メタデータから先頭画像を再解決する
- 写真も動画もcanonical URLを`https://www.tiktok.com/@<author>/<photo|video>/<postId>`とし、共有・tracking queryを除去する
- 写真の一時画像は動画と同じ非公開GCS bucketを使用し、処理後に削除する

source別thresholdと詳細routeは [jev-production-routing.md](jev-production-routing.md) を正本とする。

### 14.3 SourceContent

Worker内部では概念上以下へ変換する。

```ts
interface SourceContent {
  sourceType: SourceType;
  resolvedUrl: string;
  imageUrl: string | null;
  textForAi: string | null;
  youtubeDescription?: string | null;
  tiktokMediaKind?: "photo" | "video";
  tiktokPhotoImageUrls?: string[];
}
```

`textForAi` はAI呼び出し後に破棄し、DBへ保存しない。

### 14.4 画像取得失敗

画像取得失敗だけではAI解析失敗にしない。

```text
imageUrl = null
```

として処理継続する。

---

## 15. AI解析仕様

### 15.1 Provider / Model

MVPのレシピ抽出はZ.aiを標準とし、YouTube等のmedia fallbackにGemini / media解析を使用する。Jev本番導入後はこれらの抽出Providerの前段にsemantic routerを置く。JevはRecipeを生成せず、hard non-recipe判定またはtext / media route選択だけを担う：

```text
Provider: Z.ai
Model: glm-5.3-flash
API: Chat Completions
Response format: JSON object

YouTube fallback Provider: Gemini
YouTube fallback Model: gemini-3.5-flash-lite
YouTube fallback API: generateContent with JSON Schema
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

- 投稿文、ページ本文、画像、動画、音声、画面内テキストなど、AIへ提供されたすべての根拠に存在する事実だけを使用する
- genreの分類とtitleの生成以外を推測補完しない
- titleは明示された料理名を優先し、ない場合は材料、調理手順、画面内テキスト、発話内容、画像、動画など、提供されたすべての根拠だけから簡潔な料理名を必ず生成する
- titleへ根拠のない材料、調理方法、固有名詞、料理の特徴を追加しない
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

### 15.6 Jev semantic routing

Jevは `RecipeContentClassifier` のようなApplication interface越しに利用し、TypeSafe固有request / responseはInfrastructure adapterへ閉じ込める。productionからPoCコードを直接importしない。

Jev requestは1解析につき最大1回とし、timeout、network error、429、529、response body read失敗、invalid JSON / schema等ではretryせず即fail-openする。Jev errorはWorkerの `retryable error` として扱わず、同じWorker実行内でJev導入前の解析routeへ戻る。

初期threshold、source別routing、ログ、`not_recipe` の詳細は [jev-production-routing.md](jev-production-routing.md) を正本とする。

---

## 16. AI解析結果のDB反映

pending / processing中はユーザー編集を許可しないため、MVPではAI結果とユーザー編集の競合回避用flagを持たない。

### 16.1 title

pending / processing中の初期値：

```text
解析中のレシピ
```

AI title取得成功時はAI値で更新する。

AIには利用可能なすべての根拠から空でないtitleを生成するよう要求するが、Providerの指示不遵守によってレシピ全体を失敗扱いにしないため、Schemaでは `title: string | null` を維持する。

AI処理がcompletedだがtitleを取得できなかった場合：

```text
タイトル未取得のレシピ
```

AI解析がfailedでAI titleもない場合：

```text
解析に失敗したレシピ
```

### 16.2 genre

AI結果をそのまま反映する。

### 16.3 ingredients

AI結果で全置換する。

### 16.4 servings / cookingTime / steps

MVPではユーザー編集不可のため、AI成功時に更新する。

### 16.5 Tag

AIはTagを作成・付与しない。

### 16.6 updatedAt

AI解析結果をRecipeへ反映した場合は、Recipe本体・Ingredient・RecipeStepの変更を含めて親Recipeの `updatedAt` を更新する。

---

## 17. 非同期解析フロー

### 17.1 保存からTask enqueue

```text
POST /v1/recipes
↓
URL validation / normalization / duplicate check
↓
DB transaction開始
↓
PostgreSQL transaction-level advisory lock取得
↓
ユーザー未処理10件・日次30件・月次100件を判定（JST）
↓
システム全体未処理100件・日次500件を判定（JST）
↓
Recipe INSERT (pending) + AnalysisAdmission INSERT
↓
commit
↓
Cloud Tasks enqueue(recipeId)
↓
API response
```

受付判定とRecipe作成は同一transaction内で行う。上限到達時はRecipeを作成せず `429 ANALYSIS_LIMIT_EXCEEDED` を返す。日次はJST 00:00〜翌日00:00未満、月次はJST毎月1日00:00〜翌月1日00:00未満で判定する。

受付制御の詳細、判定順序、`AnalysisAdmission` のライフサイクルは [analysis-admission-control.md](analysis-admission-control.md) を正本とする。

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
  ├─ recipe success ---------> completed
  ├─ hard non-recipe --------> not_recipe
  ├─ Jev failure ------------> fail-openして解析継続
  ├─ permanent error --------> failed
  └─ 従来解析側のretryable error
       ├─ attempts remaining -> pending -> Cloud Tasks retry
       └─ final attempt ------> failed
```

### 17.4 最大試行回数

Cloud Tasks Queueの `maxAttempts` を **3回** とする。

Recipeには試行回数カラムを持たない。

WorkerはCloud Tasksが付与するretry / execution情報とQueue設定を利用し、現在のdeliveryが再試行可能か判定する。試行回数はCloud Loggingへ記録する。

retryable errorかつ再試行回数が残っている場合：

```text
analysisStatus = pending
↓
non-2xx response
↓
Cloud Tasks retry
```

最終試行でも失敗した場合：

```text
analysisStatus = failed
↓
失敗通知条件を評価
↓
2xx responseでTask終了
```

### 17.5 冪等性

Cloud Tasksは同一処理を複数回配送し得る前提でWorkerを冪等にする。

Worker受信時：

```text
completed -> 何もせず成功応答
failed -> 何もせず成功応答
not_recipe -> 何もせず成功応答
pending / processing -> 処理対象
```

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

Jevのtimeout、network error、HTTP 429 / 529、body read失敗、response不正はこのretryable error一覧へ含めない。Jevは1解析につき1回だけ呼び、失敗時は同一Worker実行内で従来routeへfail-openする。

ただし、14.1のYouTube Geminiフォールバックは、1レシピにつきGeminiを1回だけ呼ぶ制約を優先する例外とする。Geminiのtimeout、HTTP 429、HTTP 5xx、JSON・Schema不正を含む全失敗は`retryable=false`とし、Cloud Tasksで再試行しない。ここでの`retryable=false`は障害原因が恒久的という意味ではなく、この1回制約に基づいて当該レシピの処理を終了することを表す。

### 17.7 permanent error

例：

- source本文が取得不能
- private / login required page
- 対応不能なcontent
- 十分なAI入力textがない
- URL取得先が安全性検証に失敗

---

## 18. Analysis Error Classification

解析失敗の詳細原因はRecipe DBへ保存しない。

ユーザー向けUIは原因別表示を行わず、`analysisStatus = failed` に対して共通メッセージを表示する。

診断用には以下の分類をCloud Loggingへ構造化出力する。

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

Providerのraw error responseやsource本文は保存・出力しない。

Cloud Loggingには `recipeId / requestId / providerRequestId / errorCode / latency / attempt` 等の診断情報だけを構造化loggingし、取得本文・API key・Firebase tokenを出力しない。

---

## 19. 検索仕様

レシピ検索はBackend APIではなく、iOSのSwiftDataに同期済みのローカルデータを対象に実行する。

### 19.1 対象

- LocalRecipe.title
- LocalIngredient.name
- Genre
- Tag 1件

### 19.2 条件

テキスト検索は、空白区切りの複数tokenを **AND** とする。

各tokenについて料理名または材料名のいずれかに部分一致すればよい。

```text
q = "鶏肉 玉ねぎ"
```

概念：

```text
(title contains 鶏肉 OR ingredient contains 鶏肉)
AND
(title contains 玉ねぎ OR ingredient contains 玉ねぎ)
```

英字についてはcase-insensitiveとする。

`q / genre / tag` の指定条件はANDで結合し、検索結果は保存日時の新しい順とする。

検索はオフラインでも利用可能とする。

### 19.3 対象外

- cooking time
- servings
- steps
- source
- saved date filter
- natural language semantic search

### 19.4 検索履歴

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

表示規則：

- 表示人数が基準人数と同じ場合は、`Ingredient.amount` の原文をそのまま表示する
- 元の数量が分数の場合は、小数へ変換せず分数のまま比例計算する
- 計算後の分数は約分する
- 計算結果が1を超える非整数の場合は、`1と1/2` のような帯分数で表示する

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
- not_recipe

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

Workerがcompleted / failed / not_recipeへ遷移した後：

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
analysisResult = completed | failed | not_recipe
```

通知tap時はログイン済みであれば該当Recipe詳細を開く。

未ログインの場合は認証完了後に可能なら該当Recipeへ遷移する。

---

## 23. アカウント削除

### 23.1 対象

以下を完全削除する。

- Sign in with Apple利用Userの場合のApple関連token / authorization
- Firebase Authentication User
- User
- UserSetting
- Recipe
- AnalysisAdmission
- Ingredient
- RecipeStep
- Tag
- RecipeTag
- DeviceToken
- その他User FK配下のデータ

検索履歴等のiOS local dataも削除する。

Apple token revokeの要否はDBへprovider情報を追加せず、現在のFirebase Userの `providerData` に `providerID == "apple.com"` が含まれるかで判定する。

### 23.2 Sign in with Apple利用Userの事前処理

Firebase公式では、Firebase AuthenticationはSign in with AppleでUser作成時のApple tokenを保持しないため、token revokeとアカウント削除の前にユーザーへ再度Sign in with Appleを要求し、authorization codeを取得する必要がある。

Firebase Userの `providerData` に `apple.com` が含まれる場合、iOSはBackendのアカウント削除APIを呼ぶ前に次を実行する。

```text
アカウント削除確認
↓
Sign in with Apple authorizationを再実行
↓
ASAuthorizationAppleIDCredential.authorizationCode取得
↓
authorization codeをUTF-8 Stringへ変換
↓
Auth.auth().revokeToken(withAuthorizationCode:)
↓
revoke成功
↓
DELETE /v1/me
```

実装上のルール：

- Appleのauthorization codeは一時的にメモリ上で扱うだけとし、DB・SwiftData・UserDefaults・ファイルへ保存しない。
- authorization codeをBackendへ送信しない。
- authorization codeやApple credentialをlog / Crashlytics / Analyticsへ出力しない。
- Apple providerを含まないUserはこの処理を通さず `DELETE /v1/me` を呼ぶ。
- Firebase ConsoleのSign in with Apple provider設定は、Firebase公式のtoken revocation手順に必要なOAuth code flow設定を満たすこと。

以下の場合はBackend削除を開始しない。

- ユーザーがSign in with Appleをキャンセルした
- `authorizationCode` を取得できない
- authorization codeをStringへ変換できない
- `revokeToken(withAuthorizationCode:)` が失敗した

この場合、Firebase local session・Backendデータ・SwiftData・RecipeImages等は削除せず、ユーザーが再試行可能な状態を維持する。

MVPではApple revoke完了状態を別途永続管理しない。Apple revoke後にBackend削除が失敗した場合もlocal sessionとlocal dataを保持し、ユーザーの再試行時は同じ削除フローを先頭から実行する。

公式根拠：

- Firebase Authentication — Authenticate Using Apple: https://firebase.google.com/docs/auth/ios/apple
- Apple Human Interface Guidelines — Managing accounts: https://developer.apple.com/design/human-interface-guidelines/managing-accounts

### 23.3 Backend処理

Apple token revokeはiOS / Firebase Auth SDKの責務とし、BackendはApple authorization codeやApple tokenを受け取らない。

外部認証基盤とPostgreSQLを単一transactionにはできないため、MVPではprivacy上の残存を最小化するため次の順序とする。

```text
Firebase ID Token検証
↓
Firebase UID取得
↓
DB内Userが存在する場合はUser配下データをtransactionで完全削除
↓
Firebase AdminでFirebase User削除
↓
両方成功した場合のみ204
```

`DELETE /v1/me` では通常のUser自動作成処理を適用しない。

DB削除後にFirebase削除が失敗した場合：

- APIは成功扱いにしない
- DBデータは復元しない
- retry可能なエラーとしてClientへ返す
- local sessionを残したまま再試行可能にする
- 再試行時にFirebase UIDを基準にFirebase User削除を再実行する
- DB User recordが既に存在しなくてもUser / UserSettingを再作成しない

アカウント削除endpointではUser DB recordが既にないケースでもFirebase User削除を試行できるようにする。

### 23.4 iOS側の成功処理

`DELETE /v1/me` が204成功した場合のみ次を実行する。

- Firebase local sessionをsign out
- SwiftDataのユーザーデータを全削除
- Application SupportのRecipe画像を全削除
- sync cursor / 最終全件照合日時を削除
- 検索履歴削除
- navigation state初期化
- 認証画面へ戻る

Backend削除が失敗した場合はlocal dataを削除せず、Firebase local sessionもsign outしない。

---

## 24. Recipe削除と解析Taskの競合

Recipe削除時、既にCloud Tasksが存在する可能性がある。

MVPではTaskを個別cancelすることを必須としない。

WorkerがTaskを受信してRecipeが存在しない場合：

```text
成功応答して何もしない
```

これにより削除済みRecipeを復活させない。Recipe削除だけでは対応する `AnalysisAdmission` を削除せず、Workerが当該Taskを終端扱いにした時点で未処理枠を解放する。

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
SwiftData / APIClient / Firebase SDK / ImageStore
```

Recipeのreadは原則SwiftDataを利用し、Backendとの同期・mutationをRepository / SyncService経由で行う。

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
│  │  ├─ ModelContainerFactory.swift
│  │  ├─ LocalRecipe.swift
│  │  ├─ LocalIngredient.swift
│  │  ├─ LocalRecipeStep.swift
│  │  ├─ LocalTag.swift
│  │  ├─ LocalRecipeTag.swift
│  │  └─ SearchHistoryStore.swift
│  ├─ Sync/
│  │  └─ RecipeSyncService.swift
│  ├─ Images/
│  │  └─ RecipeImageStore.swift
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

SwiftDataのLocal modelもViewからnetwork DTOとして扱わず、Repository境界で変換・更新する。

### 25.6 SwiftDataモデル

Server DB schemaをそのまま複製せず、画面表示・検索・オフライン閲覧に必要な情報だけを保持する。

概念例：

```text
LocalRecipe
- id
- originalUrl
- sourceType
- title
- imageUrl
- servingsValue
- servingsRaw
- cookingTimeMinutes
- genre
- analysisStatus
- createdAt
- updatedAt
- ingredients
- steps
- tags
```

Server側の認可用 `userId` や重複判定専用 `normalizedUrl` はLocalRecipeへ保存しない。

Ingredient / RecipeStep / TagはServerのUUIDをそのままLocal側識別子として利用する。

### 25.7 画像保存

保存先：

```text
Library/Application Support/Foodfolio/RecipeImages/{recipeId}
```

画像ファイル名はRecipe IDから一意に決定し、LocalRecipeへローカルpathを重複保存しない。

表示フロー：

```text
ローカル画像あり
→ decode可能なら即表示

ローカル画像がdecode不可
→ 壊れたローカル画像を削除
→ ローカル画像なしとして続行

ローカル画像なし
→ onlineかつimageUrlあり
→ imageUrlからdownload
→ Application Supportへ保存
→ 表示

imageUrlから取得不可
→ originalUrlが有効ならLPMetadataProviderで代表画像metadataを取得
→ imageProviderから画像dataを取得
→ Application Supportへ保存
→ 表示

originalUrlからも取得不可
→ placeholder
→ 次回の画面表示時に再試行
```

`originalUrl` から復旧した画像はRecipe ID単位でローカル保存し、Backend管理の `imageUrl` はClient側で書き換えない。
取得画像の表示に成功し、Application Supportへの保存だけに失敗した場合は現在の画面では表示を継続し、次回の画面表示時に再取得する。失敗状態は永続保存せず、同じ画面内で自動再試行を繰り返さない。

同じRecipe ID、`imageUrl`、`originalUrl`の組み合わせを複数画面が同時に要求した場合は、端末内の共通取得Taskを共有し、取得通信を1回にまとめる。URL変更、Recipe削除、ローカルデータ全削除ではそれ以前の取得世代を無効化し、完了の遅い旧取得結果を保存しない。

画像ファイルはバックアップ対象から除外する。

同期により `imageUrl` または `originalUrl` が変更されても、有効な既存ローカル画像は削除しない。URL変更前に開始してまだ保存されていない取得だけを無効化し、次回の画像ロードでは既存ローカル画像がなければ更新後のURLから再取得する。

### 25.8 ログアウト時のLocal Data

ログアウト成功時はアカウント切り替えによる誤表示を避けるため、以下を削除する。

- SwiftData全ユーザーデータ
- RecipeImages
- sync cursor
- 最終全件照合日時
- 検索履歴

再ログイン時はBackendから再同期する。

---

## 26. iOS画面別実装責務

### SCR-01 認証

- Firebase Auth
- Apple / Google / Email
- login / signup / password reset
- 認証完了後AppSession更新
- 初回通知許可要求
- ローカルデータがなければ初回同期

### SCR-02 レシピ一覧

- SwiftDataのLocalRecipeを保存日時の新しい順で表示
- 2列grid
- pull-to-refreshで差分同期
- placeholder image
- local image優先表示
- pending / processing title表示
- FAB
- Drawer

画面表示時はnetwork responseを待たず、SwiftDataに存在するデータを即表示する。

解析完了のリアルタイムpush更新専用socket等は導入しない。

画面再表示、pull-to-refresh、通知tap、foreground復帰等を契機に差分同期する。

同期失敗時も既存のLocalRecipeは維持する。

### SCR-03 URL追加Sheet

- URL入力
- local format check
- online必須
- `POST /v1/recipes`
- 201でレスポンスをSwiftDataへ反映してSheet close
- 409で既存Recipeへの導線
- 429で受付上限に応じた日本語メッセージを表示
- AI完了は待たない

オフライン時は未同期Recipeを作らず、通信が必要であることを表示する。

### SCR-04 レシピ検索

- query入力
- genre 1件
- tag 1件
- local検索履歴
- SwiftDataに対してローカル検索
- queryなし + filterありを許可
- オフライン利用可能

### SCR-05 レシピ詳細

- LocalRecipe detail表示
- servings表示
- 分量比例計算
- Tag追加Bottom Sheet
- 元URL open
- edit navigation
- delete
- analysis error共通表示

Tag追加・削除、Recipe削除等のmutationはオンライン必須とする。

### SCR-06 レシピ編集

- title
- ingredients
- genre
- tags
- save時PATCH

`pending / processing` 中は編集画面へ遷移させない。Backendでも同状態のPATCHを拒否する。

編集はオンライン必須とし、成功レスポンスをSwiftDataへ即時反映する。

### SCR-07 設定

- Backend notification setting
- OS notification authorization state
- OS Settingsへの導線

### SCR-08 アカウント

- Firebase user info表示
- provider表示
- logout
- account delete
- Firebase Userに `apple.com` が含まれる場合のSign in with Apple再authorization
- Apple authorization code取得 / token revoke
- revoke成功後の `DELETE /v1/me`
- logout / account delete成功時のLocal Data cleanup

Apple revoke失敗・キャンセル・Backend削除失敗ではLocal Data cleanupを実行しない。

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

永続Recipe stateはSwiftDataを正とし、各Featureから必要なqueryを行う。

### 27.2 Loading / Error

各Feature ViewModelは概念上以下を持つ。

```text
idle
loading
loaded
error
```

保存・編集等のmutationは画面全体の状態と分離して `isSubmitting` 等で管理してよい。

ローカルデータが存在する場合、同期中であることを理由に画面全体をloadingへ戻さない。

---

## 28. 同期設計

### 28.1 Source of Truth

```text
Neon PostgreSQL = 正本
SwiftData = ローカルコピー
```

ローカル変更を後からServerへmergeする双方向同期は行わない。

### 28.2 初回同期

```text
認証完了
↓
GET /v1/sync
↓
Recipe / Ingredient / Step / Tag関係をSwiftDataへupsert
↓
nextCursor保存
↓
必要な画像を遅延取得
```

### 28.3 差分同期

```text
GET /v1/sync?cursor=<lastCursor>
↓
変更RecipeをSwiftDataへupsert
↓
成功した場合のみnextCursorへ更新
```

同期cursorはBackend発行のopaque stringとし、Clientは内部構造へ依存しない。

端末時刻を `lastSyncAt` としてServer query条件へ送らない。

### 28.4 hard delete照合

RecipeはServerでhard deleteするため、差分同期だけでは他端末で削除されたRecipeを検出できない。

最終全件照合から24時間以上経過し、オンラインで同期できる場合：

```text
GET /v1/sync/recipe-ids
↓
Server IDsとLocal IDsを比較
↓
Serverに存在しないLocalRecipeを削除
↓
該当Recipe画像も削除
↓
lastFullReconciliationAt更新
```

MVPではtombstone / change logを追加しない。

### 28.5 mutation成功時

POST / PATCH / Tag付与・解除等のAPI成功時は、次回同期を待たずレスポンスをSwiftDataへ反映する。

DELETE成功時はLocalRecipeと画像を即時削除する。

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

pending / processing中のRecipe編集を禁止するため、MVPではAI更新とユーザー編集が同時発生する競合を許容しない。

`titleUserEdited / genreUserEdited / ingredientsUserEdited` のような競合回避flagは持たない。

### 29.4 同期用updatedAt

以下の変更では必ず親Recipeの `updatedAt` を更新する。

- Recipe本体の編集
- Ingredient変更
- RecipeTag付与・解除
- AI解析結果反映
- analysisStatus変更

これにより差分同期が関連データの変更を取りこぼさないようにする。

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
jevModel
recipeProbability
nonRecipeProbability
jevThresholdName
jevThresholdValue
jevSelectedRoute
jevFinalRoute
jevLatencyMs
jevFailureClass
jevInputChars
jevInputSha256
```

`analysisAttempt` と `errorCode` は診断用ログ項目であり、Recipe DBへ永続保存しない。Jev probability / thresholdもRecipe DBへ永続保存せず構造化ログへ記録する。閾値再評価を容易にするため、Jev route決定時だけでなく最終解析outcomeにもprobability / threshold snapshotを含める。Jevへ送った本文はログへ保存せず、正規化済み入力の `inputChars` とSHA-256だけを記録する。

Jevログだけではthreshold未満ケースのtext route成功可否を断定できないため、候補probability帯をログから抽出し、元URLを再取得して `inputSha256` 一致を確認したうえで再評価する。詳細は [jev-production-routing.md](jev-production-routing.md) を参照する。

禁止：

- Firebase ID Token
- Apple authorization code / Apple credential
- Z.ai API Key
- TypeSafe / Jev API Key
- YouTube Data API Key
- DB password
- source本文全文
- AI raw response全文
- private credential

初回TestFlightではCrashlytics / Analyticsを利用せず、TestFlight標準のセッション、クラッシュ、フィードバックを利用する。利用者数が増えた段階で、取得データとイベントを再設計する。

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
YOUTUBE_API_KEY
GEMINI_API_KEY
TYPESAFE_API_KEY
YOUTUBE_GEMINI_FALLBACK_ENABLED=false
AI_MODEL=glm-5.3-flash
MAX_ANALYSIS_ATTEMPTS=3
TIKTOK_MEDIA_ANALYSIS_ENABLED=true # dev。新規環境の既定値はfalse
TIKTOK_VIDEO_BUCKET
TIKTOK_VIDEO_MAX_ATTEMPTS=5
YT_DLP_PATH=/usr/local/bin/yt-dlp
JEV_GENERAL_WEB_NON_RECIPE_THRESHOLD=0.80
JEV_YOUTUBE_RECIPE_THRESHOLD=0.99
JEV_INSTAGRAM_RECIPE_THRESHOLD=0.99
JEV_TIKTOK_VIDEO_RECIPE_THRESHOLD=0.99
JEV_TIKTOK_PHOTO_RECIPE_THRESHOLD=0.99
JEV_AI_CHAT_NON_RECIPE_THRESHOLD=0.99
```

`MAX_ANALYSIS_ATTEMPTS` はCloud Tasks Queueのretry設定とWorkerの最終試行判定で同じ値を使用する。

`ZAI_API_KEY` / `YOUTUBE_API_KEY` / `GEMINI_API_KEY` / `TYPESAFE_API_KEY` / DB接続情報はSecret ManagerからCloud Runへ渡す。`TYPESAFE_API_KEY` はJevを呼ぶWorkerだけに付与し、API serviceへは原則付与しない。`YOUTUBE_GEMINI_FALLBACK_ENABLED`は既定で`false`とし、`true`でも実際にGeminiが必要になるまでAPI keyは使用しない。fallbackが必要な時点でkeyが未設定なら、識別可能な設定エラーとして解析を失敗させる。

`TIKTOK_MEDIA_ANALYSIS_ENABLED`は書面許可を確認した環境だけで`true`とし、TikTok動画フォールバックと写真投稿の主経路をまとめて制御する。dev環境は許可確認済みのため有効化する。`TIKTOK_VIDEO_BUCKET`は名前を維持した公開アクセス禁止の一時保存専用bucketであり、動画・写真本体や署名URLをDBへ保存しない。

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
- amount比例計算
- range servings判定
- analysis state transition
- retry判定
- AI Schema validation
- AI result → DB mapping
- API error mapping
- sync cursor処理
- Local Recipe検索条件
- SearchHistoryStore
- RecipeImageStore path / cleanup

### 33.2 Integration Test

最低限：

- Prisma CRUD
- URL unique constraint
- Tag unique constraint
- RecipeTag ownership validation
- Recipe delete cascade
- account DB cascade delete
- account delete再試行時にDB Userを再作成しないこと
- DB Userが既に削除済みでもFirebase User削除を再試行できること
- 差分同期Query
- Ingredient / RecipeTag / AI更新時のRecipe.updatedAt更新
- Recipe ID全件照合API
- API route + fake auth adapter
- Worker + fake URL extractor + fake AI adapter + test DB

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
- SwiftData upsert / delete
- Local Recipe検索
- 差分同期cursor更新
- hard delete reconciliation
- RecipeImageStore
- SearchHistoryStore
- servings amount scaling
- API error → UI message mapping
- notification setting表示判定
- `apple.com` providerを含む場合にApple revoke成功後だけ `DELETE /v1/me` を呼ぶこと
- Apple authorizationキャンセル / code取得失敗 / revoke失敗時にBackend削除とLocal Data cleanupを実行しないこと
- Apple providerを含まない場合はApple revokeを行わず `DELETE /v1/me` を呼ぶこと
- `DELETE /v1/me` 失敗時にFirebase local sessionとLocal Dataを保持すること

UI automationはMVPの主要flowに限定する。

---

## 34. CI

Pull RequestではDraft中に実装とReady前の確認を進め、Draftの `opened` / `synchronize` ではAuto Fix / QualityのPR用runnerを起動しない。Ready後の同一repository・人間起点PRではAuto Fixを先に実行し、最新HEADを確定してからQualityを `workflow_dispatch` する。QualityはPR contextを検証したうえでbaseとHEADのprospective merge treeを構築し、その仮マージ結果に対して検証する。Auto Fix Appがformat commitをpushした場合はbot起点の最新 `synchronize` RunへQuality dispatch責務を引き継ぎ、Auto Fix処理を繰り返さずQualityを1回だけ起動する。

Auto Fix対象外の非Auto-Fix bot PR（Dependabot等）とfork PRは例外とし、Ready時にread-only Qualityを `pull_request` から直接実行する。これらのdirect QualityはGitHubのpull request merge refを検証対象とする。自動修正やPR Quality proofの再利用はsame-repositoryの信頼できる経路に限定する。

Qualityは変更ファイルを分類し、Backendまたは共有設定へ影響する変更ではBackend向けのformat、lint、architecture、Prisma、build、unit、integration、E2E等を実行する。未知のパスは安全側でBackend変更として扱う。iOS関連の変更では、Ubuntu上のSwift 6.3公式コンテナを使用して `swift format lint --recursive --strict` を実行する。CIではmacOS runnerを使用せず、iOSのbuild、test、結合テスト、UI E2Eはローカルの `npm run verify:ios` で検証する。

Markdownまたは `docs/` だけの変更でもQuality workflowは起動するが、Backend全体向けの高コストstepは変更分類により省略する。独立したDocumentation workflowは使用せず、Qualityの同一runner内で `npm run tasks:check`、`npm run check:specs`、`npm run verify:autonomous-p0`、`npm run check:docs` と変更Markdownのformat checkを実行する。このため、required checkの設計は「docs-only PRではQualityが起動しない」前提にしない。

`main` pushでは、同一repositoryの成功済みPull Request Qualityが同じGit treeを検証した証跡を30日間再利用し、treeが一致しない場合、証跡が失効した場合、または証跡を確認できない場合に同じ検証を再実行する。

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

dev deployは成功した`main` Qualityの対象SHAだけを受け取り、Backend関連ファイル
に変更がある場合に実行する。変更判定にはCloud Run APIとWorkerの両方が実際に
使用している同一イメージタグのSHAからQuality対象SHAまでの範囲を使う。これにより、
途中のQualityがキャンセルされた場合も未デプロイ変更を次の判定へ引き継ぐ。
デプロイ済みSHAを取得できない、APIとWorkerが一致しない、またはGit履歴を検証
できない場合はデプロイを省略しない。自動deployでは同じQualityを再実行しない。
手動deployはPull Request Qualityの証跡を前提にできないため、deploy前に通常Qualityを
実行する。

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

### Phase 2: Recipe保存・ローカル永続化

1. URL validation / normalization
2. POST `/recipes`
3. GET `/recipes`
4. GET `/recipes/:id`
5. Sync API
6. SwiftData model / Repository
7. RecipeImageStore
8. iOS Recipe一覧
9. URL追加Sheet

この時点ではAIなしでも保存・同期・一覧・詳細が成立する状態にする。

### Phase 3: Worker / AI

1. Cloud Tasks enqueue
2. Worker OIDC endpoint
3. PoC URL extractor移植
4. SafeHttpClient / SSRF対策
5. Schema共通化
6. Z.ai adapter移植
7. analysis state transition
8. DB更新
9. SwiftDataへの解析結果同期

### Phase 4: 詳細・編集・Tag

1. Recipe詳細
2. PATCH Recipe
3. Recipe削除
4. Tag作成
5. Tag付与 / 解除
6. servings比例表示
7. mutation成功時のSwiftData即時反映

### Phase 5: Search

1. SwiftDataローカル検索
2. iOS検索画面
3. UserDefaults検索履歴
4. オフライン検索確認

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
3. Apple provider判定
4. Sign in with Apple再authorization / authorization code取得
5. `Auth.auth().revokeToken(withAuthorizationCode:)`
6. `DELETE /v1/me` と部分失敗時の再試行
7. SwiftData / RecipeImages / sync metadata cleanup

### Phase 8: 実環境検証

技術選定書で後続検証として残っている以下を実環境で確認する。

- Cloud Tasks → Cloud Run Worker
- Cloud Run → Neon pooled connection
- Prisma migration
- Apple / Google / Email Firebase Authentication
- Sign in with Appleアカウント削除時のauthorization code取得 / token revoke
- Password reset
- FCM → APNs実機通知
- Singapore構成の実機体感latency
- 差分同期 / 全件照合
- オフライン閲覧・検索
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
- 画像専用Cloud Storage
- 画像の再インストール / 新端末復元保証
- 調理時間検索
- semantic / vector search
- オフラインmutation queue
- オフライン編集
- WebSocket / realtime DB同期
- 複数端末のリアルタイム整合保証
- sync tombstone / change log
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
- Recipe / Tag / Setting / DeviceToken / Sync API
- URL重複判定
- SSRF対策
- SwiftData model / local persistence
- 差分同期 / hard delete reconciliation
- Recipe画像の端末保存
- Local Recipe検索条件
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
