# foodfolio MVP 技術選定書

## 1. 本書の目的

本書は、foodfolio MVPを実装するために採用する技術スタックと、その選定理由、制約、技術検証方針を明確にする。

対象は以下とする。

- iOSアプリ
- iOSローカル永続化
- Backend API
- Database
- Authentication
- 非同期処理
- AI解析
- Push Notification
- URL / Webコンテンツ取得
- 画像の扱い
- Infrastructure as Code
- CI / CD
- Analytics / Crash Reporting

詳細なAPI仕様、データモデル、画面単位の実装構造、エラーコード等は後続の実装設計で扱う。

本書の選定内容は2026-08-27時点のMVP要件および各サービスの公開仕様を前提とする。

---

## 2. 技術選定の前提

### 2.1 MVP条件

- iOSアプリのみを対象とする
- MVPはTestFlightで外部ユーザーに配布する
- 想定ユーザー数は最大10人程度
- URL保存後のAI解析は非同期で行う
- ユーザーごとにレシピデータを分離する
- Apple / Google / メール認証を提供する
- 解析成功 / 失敗をPush通知できるようにする
- 料理名、材料、ジャンル、タグによる検索・絞り込みを行う
- 保存済みレシピはオフラインで閲覧・検索可能とする
- URL追加・編集・タグ変更・削除はオンライン必須とする
- レシピ、材料、タグ等はリレーショナルなデータとして扱う

### 2.2 コスト条件

- AI利用料を除くインフラ費用は月1,000円程度までを目安とする
- AIは価格だけで決定せず、レシピ抽出精度との総合評価で決める
- 小規模MVPのため、常時起動リソースをできるだけ持たない
- 無料枠・従量課金・scale-to-zeroを積極的に利用する

### 2.3 開発条件

既存経験を活用できる以下の技術は学習コストが低い。

- TypeScript
- React / Next.js
- Node.js
- Firebase Authentication
- Cloud Run
- Cloud SQL
- PostgreSQL
- Prisma
- GCP
- Terraform

ただし、経験済みであることだけを理由に採用せず、MVP適合性を優先する。

---

## 3. 採用技術スタック

| 領域 | 採用技術 | 状態 |
| --- | --- | --- |
| iOS | Swift + SwiftUI | 採用 |
| Minimum iOS | iOS 26.0 | 採用 |
| iOSローカルDB | SwiftData | 採用 |
| iOS画像保存 | FileManager / Application Support | 採用 |
| Backend Runtime | Node.js + TypeScript | 採用 |
| Backend Hosting | Google Cloud Run | 採用 |
| Database | Neon PostgreSQL | 採用 |
| ORM | Prisma | 採用 |
| Authentication | Firebase Authentication | 採用 |
| 非同期Queue | Google Cloud Tasks | 採用 |
| Worker | Google Cloud Run | 採用 |
| Push Notification | Firebase Cloud Messaging + APNs | 採用 |
| AI Provider | Z.ai / `glm-5.3-flash` | PoC合格・MVP採用 |
| AI出力検証 | JSON Schema相当 + アプリ側Schema validation | 採用 |
| YouTube metadata | YouTube Data API v3 `videos.list(part=snippet)` | 採用 |
| IaC | Terraform | 採用 |
| Secrets | Google Cloud Secret Manager | 採用 |
| Crash Reporting | TestFlight標準のクラッシュ情報 | 初回TestFlightで利用 |
| Analytics | TestFlight標準のセッション情報 | 初回TestFlightで利用 |
| 画像Cloud Storage | MVP初期は専用Storageを持たない | 採用 |

---

## 4. 全体構成

```text
┌──────────────────────────────┐
│ iOS App                      │
│ Swift / SwiftUI / iOS 26+    │
│                              │
│ SwiftData                    │
│ Application Support          │
└──────────────┬───────────────┘
               │
               │ Firebase Authentication
               │ ID Token / sync / mutation
               ▼
┌──────────────────────────────┐
│ Cloud Run API                │
│ Node.js / TypeScript         │
└───────┬──────────┬───────────┘
        │          │
        │ Prisma   │ enqueue
        ▼          ▼
┌──────────────┐  ┌───────────────┐
│ Neon         │  │ Cloud Tasks   │
│ PostgreSQL   │  └───────┬───────┘
│ Source of    │          │ authenticated HTTP
│ Truth        │          ▼
└──────────────┘  ┌─────────────────┐
                  │ Cloud Run Worker│
                  │ Node.js / TS    │
                  └───────┬─────────┘
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼
        URL情報取得    AI Provider   Neon PostgreSQL
                          │
                          ▼
                   構造化レシピJSON
                          │
                          ▼
                   Schema validation
                          │
                          ▼
                     DBへ反映
                          │
                          ▼
                    FCM → APNs
                          │
                          ▼
                       iPhone
```

### 4.1 Backend構成方針

MVPではマイクロサービスを細分化しない。

Node.js / TypeScriptの1リポジトリ内で、以下を論理的に分離する。

- API
- Worker
- Domain / UseCase
- Database access
- AI Provider adapter
- URL content extractor
- Notification adapter

デプロイ単位は以下の2 Cloud Run Serviceを基本とする。

```text
foodfolio-api
foodfolio-worker
```

APIとWorkerを別Serviceにする理由は、同期APIとAI解析処理で実行時間・負荷・失敗時の扱いが異なるためである。

---

## 5. iOS

### 5.1 Swift + SwiftUI

MVPはiOSのみを対象とするため、クロスプラットフォーム技術を導入せずSwift + SwiftUIを採用する。

理由：

- iOS固有機能との統合が直接的
- Sign in with Apple、Push Notification、TestFlightとの親和性が高い
- React Native / Flutter用の追加抽象化を持つ必要がない
- iOSのみのMVPではクロスプラットフォーム化のメリットが小さい

### 5.2 Minimum iOS

Minimum Deployment Targetは **iOS 26.0** とする。

2026-08-27時点でiOS 27 / Xcode 27はbeta系列であり、安定版を前提としたMVPではiOS 26系を最低バージョンとする。

開発期間中にiOS 27が正式リリースされても、MVP途中で理由なくMinimum Deployment Targetを変更しない。iOS 27専用APIが実装を大幅に簡単化し、TestFlight対象端末にも問題がない場合のみ再評価する。

### 5.3 iOS側ライブラリ方針

MVPでは依存ライブラリを増やしすぎない。

基本：

- UI: SwiftUI
- HTTP: URLSession
- Local persistence: SwiftData
- Local image storage: FileManager
- Auth: Firebase Authentication SDK
- Push: Firebase Messaging SDK

初回TestFlightではFirebase CrashlyticsとFirebase AnalyticsをiOS targetに含めない。利用者数が増え、TestFlight標準情報では判断できない課題が生じた段階で導入を再検討する。

### 5.4 ローカル永続化

Neon PostgreSQLをユーザーデータの正本（Source of Truth）とし、iOS側はSwiftDataにRecipe、Ingredient、RecipeStep、Tag、RecipeTag等のローカルコピーを保持する。

ローカルコピーは以下に利用する。

- アプリ起動直後の表示
- レシピ一覧・詳細
- ローカル検索
- オフライン閲覧・検索

MVPではオフラインmutation queueや競合解決を実装せず、追加・編集・タグ変更・削除はオンライン必須とする。

---

## 6. Authentication

Firebase Authenticationを採用する。

対応方式：

- Sign in with Apple
- Google Sign-In
- Email / Password

メール認証では以下を提供する。

- 新規登録
- ログイン
- パスワードリセット

### Backend認証

iOSからCloud Run APIを呼ぶ際はFirebase ID Tokenを送信する。

BackendではFirebase Admin SDK等を利用してTokenを検証し、Firebase UIDをアプリケーション上のユーザー識別子として利用する。

```text
iOS
↓ Firebase ID Token
Cloud Run API
↓ token verification
Firebase UID
↓
User data access
```

独自のPassword認証・JWT発行基盤は実装しない。

---

## 7. Database

### 7.1 Neon PostgreSQL

DatabaseはNeon PostgreSQLを採用する。

Cloud SQLではなくNeonを採用する主な理由は、MVP規模では常時稼働DBの固定費を避けたいこと、およびPostgreSQL / Prismaの開発経験を維持できることである。

Neonはscale-to-zeroに対応しているため、小規模・低頻度アクセスのMVPと相性が良い。

### 7.2 Region

NeonにはAWS Asia Pacific (Singapore)リージョンがある。

初期構成では以下を基本とする。

```text
Cloud Run: asia-southeast1 (Singapore)
Neon: AWS Asia Pacific (Singapore)
```

APIとDatabaseを可能な限り同一地域に寄せ、Backend ↔ Database間の遅延を抑える。

TestFlight利用者は主に日本からアクセスする想定だが、日本端末 → Singapore APIの体感性能はPoC / 実機テストで確認する。

性能上問題がある場合は、Cloud RunだけをTokyoに変更するのではなく、Backend ↔ DB間の往復も含めて構成全体を再評価する。

### 7.3 初期TestFlightの環境方針

初期TestFlightでは独立したProduction環境を構築せず、現在のGCP / Firebase / Neonバックエンド環境を利用する。利用者数、データ保護、可用性、運用監視などの要件が生じた段階で、Production環境の分離を再検討する。

### 7.4 Prisma

ORMはPrismaを採用する。

Cloud Runのようにインスタンス数が変動する環境では、Neonのpooled connection stringを利用する。

DB migrationについてはPrisma Migrateを利用する。

### 7.5 Search

MVPのレシピ検索は、iOSに同期済みのSwiftDataを対象にローカル実行する。

検索対象：

- 料理名の部分一致
- 材料名の部分一致
- ジャンル絞り込み
- タグ絞り込み
- 上記条件の組み合わせ

これにより検索時のBackend round tripを不要とし、オフライン検索を可能にする。

MVP規模ではAlgolia、Elasticsearch、OpenSearch等は導入しない。

レシピ件数の増加等により端末内検索が実用上問題になった場合のみ、Backend検索や専用検索基盤を再検討する。

---

## 8. 非同期処理

Cloud Tasks + Cloud Run Workerを採用する。

### 処理フロー

```text
URL保存API
↓
Recipeをpending状態でDB保存
↓
Cloud Tasksへ解析Task登録
↓
APIはユーザーへ即時応答
↓
Cloud Run WorkerへTask配送
↓
URL情報取得
↓
AI解析
↓
結果Validation
↓
DB更新
↓
completed / failed
↓
通知設定ONならFCM送信
```

Cloud TasksはHTTP endpointへ非同期Taskを配送でき、リトライを管理できるため今回の処理に適している。

Worker endpointは一般公開APIとして利用せず、Cloud Tasksから認証されたリクエストのみ受け付ける構成を基本とする。

### MVPで導入しないもの

- Pub/Subを中心としたEvent Driven Architecture
- Kafka
- Kubernetes
- 独自Queue Server

現在の規模では構成が過剰になるため採用しない。

---

## 9. AI解析

### 9.1 採用Provider / Model

PoCの固定5 fixtureと5実URL×3回のE2E結果に基づき、MVPの標準AIを以下に確定する。

- 標準Provider: Z.ai
- 標準Model: `glm-5.3-flash`
- API: Chat Completions JSON mode
- Backend側でRecipe Schema validationを必須とする

YouTubeだけは、YouTube Data APIで取得した説明欄に材料と複数工程が明確にある場合は標準Z.ai経路を使い、不十分または判定不能の場合に限ってGemini `gemini-3.5-flash-lite`へ公開動画URLと説明欄を同じ1リクエストで渡す。Geminiの根拠付き中間Schemaを決定論的にRecipe Schemaへ変換し、材料・手順が空の結果は保存しない。このfallbackは`YOUTUBE_GEMINI_FALLBACK_ENABLED`で既定無効とする。

Gemini 3.5 Flash-Lite Free Tierも同じ5 fixtureで比較したが、人数範囲を根拠なく平均化した1件があり、Hallucination 0件の基準を満たさなかった。OpenAIとDeepSeekはZ.aiが全基準を満たしたため、追加課金を避けて未実施とした。

### 9.2 選定原則

一般的なLLMベンチマークだけでは決定しない。

foodfolioで実際に必要なタスクは、Webページ等から以下を構造化抽出することである。

- 料理名
- 材料名
- 分量
- 基準人数
- 調理時間
- ジャンル
- 調理手順

そのため、実レシピを利用したPoCで精度とコストを評価する。

### 9.3 AI Provider abstraction

Backendから特定Provider SDKを直接Domain Logicへ埋め込まない。

概念上、以下のようなinterfaceを設ける。

```ts
interface RecipeExtractor {
  extract(input: RecipeSource): Promise<ExtractedRecipe>
}
```

Provider固有処理はAdapterに閉じ込める。

```text
RecipeExtractor
├─ GeminiRecipeExtractor
├─ OpenAIRecipeExtractor
├─ DeepSeekRecipeExtractor
└─ ZaiRecipeExtractor
```

これにより、価格・性能・提供条件の変化に応じてProviderを交換しやすくする。

### 9.4 Structured Output

可能なProviderではJSON Schema等のStructured Output機能を利用する。

それだけに依存せず、Backend側でもSchema Validationを必須とする。

想定フロー：

```text
LLM response
↓
JSON parse
↓
Schema validation
├─ valid   → DB変換
└─ invalid → retry / failed
```

TypeScript側のSchema validation libraryは実装設計時に決定する。

---

## 10. AI PoC

### 10.1 テストデータ

複数の出典を含む固定テストセットを作る。

最低限、以下を混在させる。

- 一般レシピサイト
- クラシル
- クックパッド
- YouTube
- Instagram
- TikTok
- 情報が一部不足するページ
- 解析困難なページ

可能であれば20〜30件程度から開始する。

### 10.2 比較指標

モデルごとに以下を測定する。

| 指標 | 内容 |
| --- | --- |
| 料理名精度 | 原典と一致しているか |
| 材料精度 | 材料の欠落・混入がないか |
| 分量精度 | 材料と正しく対応しているか |
| 人数精度 | 原典に存在する場合のみ取得できるか |
| 調理時間精度 | 原典情報を正しく取得できるか |
| ジャンル精度 | 固定候補から適切に分類できるか |
| 手順精度 | 手順の欠落・捏造がないか |
| Schema成功率 | 期待Schemaとして処理できる割合 |
| Hallucination | 原典にない情報を生成していないか |
| Cost | 1レシピ解析あたりの費用 |
| Latency | 1レシピ解析時間 |

### 10.3 決定方法

最安モデルを自動採用しない。

以下の順で判断する。

1. 必須品質を満たすか
2. Hallucinationが許容範囲か
3. 構造化出力が安定するか
4. その条件を満たすモデルの中でコストが低いか
5. Provider lock-inを許容できるか

---

## 11. URL / Webコンテンツ取得

URL取得はサービス判定後に取得経路を分岐する。

基本方針：

1. URL文字列からsourceを判定する
2. YouTubeは通常HTTPでページHTMLを取得せず、URLからvideoIdを抽出してYouTube Data API v3を使用する
3. YouTube以外は通常HTTP取得を基本とする
4. HTML metadata / OGP / JSON-LD等の機械取得可能情報を利用する
5. 通常取得で不足するサービスのみ、公開仕様・利用規約に沿った個別対応を検討する
6. JavaScript実行が不可欠で、かつ利用条件上問題がない場合のみHeadless Browserを検討する

利用規約・API仕様・アクセス制限を無視した実装は採用しない。

### 11.1 YouTube

YouTubeは一般Webページとしてscrapeしない。

現行の取得フローを以下に固定する。

```text
YouTube URL
↓
URL文字列からvideoIdを抽出
↓
YouTube Data API v3
GET https://www.googleapis.com/youtube/v3/videos
  ?part=snippet
  &id=<videoId>
  &key=<YOUTUBE_API_KEY>
↓
snippet.title
snippet.description
snippet.thumbnails
snippet.channelTitle
↓
AI入力 / imageUrlへ変換
```

`videos.list(part=snippet)`の公式レスポンスには、`channelId`、`title`、`description`、`thumbnails`、`channelTitle`、`tags`、`categoryId`等が含まれる。foodfolioのMVPで必要な主要情報は`title`、`description`、`thumbnails`で満たす。

公開動画メタデータの取得ではユーザーOAuthを要求せず、Backendが保持するAPI keyを使用する。`YOUTUBE_API_KEY`はGoogle Cloud Secret Managerで管理し、iOSアプリやリポジトリへ埋め込まない。

`videos.list`のquota costは公式仕様上1 requestあたり1 unitである。

旧PoCで使用した以下は本番実装および現行PoCから除外する。

- YouTube動画ページHTMLの自動取得
- `ytInitialPlayerResponse.videoDetails.shortDescription`の解析
- YouTubeページ内部JSON構造への依存
- YouTube oEmbedを説明文取得の主経路として利用すること

Data APIへ変更後も、AIへ渡す中心情報は動画タイトルと動画説明欄であり、代表画像は`snippet.thumbnails`から取得する。

説明欄の材料行と複数工程を決定論的に確認できる場合は動画を送らずZ.aiで解析する。どちらかが不足するか判定不能の場合だけ、設定で許可されていれば公開YouTube URLと説明欄をGemini `gemini-3.5-flash-lite`へ同時に渡す。説明欄全文やGemini生応答は通常ログへ残さず、実際に使ったproviderだけをRecipe内部記録と構造化ログへ残す。この内部記録は公開Recipe APIへ追加しない。

取得時間についてGoogleによる応答時間保証は確認できないため、旧方式と同等以上であるとは事前に断定しない。`YOUTUBE_API_KEY`を設定した実URL再PoCでData API requestのelapsed timeを記録する。

### 11.2 その他のサービス

Instagram、TikTok等は一般Webページと取得条件が異なるため、公開仕様と実測結果に基づいてサービス別Extractorを使用する。

TikTokはoEmbedタイトルを先に`glm-5.3-flash`で解析し、材料または手順が0件の場合だけ動画フォールバックの候補とする。動画入力にも同じ`glm-5.3-flash`を使用する。取得は`yt-dlp 2026.08.19`、初回を含めて最大5回、MP4 100MB以下とする。

書面許可のない自動抽出は有効化しない。`TIKTOK_VIDEO_FALLBACK_ENABLED=false`を新しい環境の既定値とし、許可を確認した環境だけで有効化する。dev環境は書面許可を確認済みのため`true`とする。

有効化後は動画を非公開GCS bucketへ一時保存し、10分の署名URLでZ.aiへ渡す。通常完了時は即時削除し、異常終了時は1日後のlifecycle削除を安全網とする。動画、署名URL、yt-dlp生出力は通常ログやRecipe DBへ保存しない。

### PoCで確認すること

- title相当情報を取得できるか
- thumbnail / OGP画像URLを取得できるか
- AIへ渡せる本文情報を取得できるか
- JavaScript実行が必要か
- ログイン必須ページをどう扱うか
- rate limit / bot対策等により安定取得できないケースが何か
- YouTube Data API経路の実URL取得時間とE2E結果

---

## 12. 画像

MVP初期では、画像保存専用のCloud Storageを必須構成にしない。TikTok動画フォールバック用bucketは画像保存用途ではなく、AI解析中だけ使う非公開の一時領域として分離する。

元ページから取得できた代表画像URLはRecipeデータの `imageUrl` としてBackend DBへ保持する。これは端末側に画像が存在しない場合の再取得元として利用する。

iOSは画像を初回取得した際、Application Support配下のアプリ管理領域へ保存し、以後はローカル画像を優先して表示する。

```text
ローカル画像あり
→ ローカル画像を表示

ローカル画像なし + オンライン + imageUrl有効
→ imageUrlから取得
→ Application Supportへ保存
→ 表示

ローカル画像なし + imageUrlから取得不可
→ プレースホルダー
```

画像は同一端末でアプリがインストールされている間は原則保持する。アプリ削除・再インストール・新端末への移行後の復元はMVPでは保証しない。

外部から再取得可能な画像であるため、Application Supportへ保存する画像ファイルはバックアップ対象から除外する。

Google Cloud Storage等のfoodfolio管理画像StorageはMVPでは追加しない。画像URL失効時のBackend再解析・再取得もMVP対象外とする。

---

## 13. Push Notification

Firebase Cloud Messagingを採用し、iOSへの最終配送にはAPNsを利用する。

```text
Cloud Run Worker
↓
Firebase Cloud Messaging
↓
APNs
↓
iOS
```

通知対象：

- AI解析成功
- AI解析失敗

UserSettingの「レシピ解析通知」がOFFの場合は送信しない。

iOS通知権限が未許可の場合は、Backend側の解析自体には影響させない。

通知Tokenはユーザーに紐づけてBackendで管理する。

---

## 14. Infrastructure as Code

Terraformを採用する。

原則として以下をTerraform管理対象とする。

- Google Cloud Project側の必要API
- Cloud Run Service
- Service Account
- IAM
- Cloud Tasks Queue
- Secret Manager
- Artifact Registry
- 必要なFirebase / GCP設定のうちTerraform管理可能な範囲

Apple Developer PortalやFirebase Console等、Terraformだけで安全に完結しない設定は手順としてドキュメント化する。

NeonについてもTerraform Provider等で安定管理できる範囲はIaC化を検討するが、MVPではIaC化そのものを目的化しない。

---

## 15. CI / CD

GitHubをソース管理の中心とし、BackendはGitHub ActionsからGCPへデプロイする構成を基本とする。

```text
GitHub
↓
GitHub Actions
↓
Build / Test
↓
Artifact Registry
↓
Cloud Run
```

iOSはMVP初期ではXcode / App Store ConnectによるTestFlight配布を基本とし、Fastlane等の追加自動化は必要性が出てから検討する。

---

## 16. Analytics / Crash Reporting

初回の外部TestFlight検証ではFirebase CrashlyticsとFirebase Analyticsを導入せず、TestFlight標準のセッション、クラッシュ、フィードバックを利用する。

利用者数が増えた段階で、必要なイベントと取得データを改めて設計し、Firebase Crashlytics / Analyticsの導入を再検討する。

---

## 17. コスト方針

### 17.1 Cloud Run

Cloud Runは従量課金で無料枠があり、minimum instancesを0にできる。

MVPではAPI / Workerともにminimum instancesを0とする。

### 17.2 Cloud Tasks

Cloud Tasksは月最初の100万billable operationsが無料枠となっている。

### 17.3 Firebase

- Firebase Cloud Messagingは無料
- Firebase Authenticationには無料利用枠がある
- Crashlytics / Analyticsは初回TestFlightでは利用せず、利用者数が増えた段階で導入を再検討する

### 17.4 Neon

NeonはFree planとscale-to-zeroを利用できる。

開発・初期TestFlightではFree planから開始し、利用量・運用上の制約が問題になった場合に従量課金Planへの移行を検討する。

### 17.5 注意

「ユーザー10人」であることだけでは月額費用が必ず1,000円以下になるとは保証できない。

費用は以下に左右される。

- AI呼び出し量
- 外部Network egress
- Cloud Logging量
- Artifact Registry / Build利用量
- Neon compute / storage / egress
- URL取得時のデータ量

GCP Billing Budget / Alertを設定し、意図しない課金を検知できるようにする。

AI料金はインフラ予算とは分離して観測する。

---

## 18. 不採用案

### 18.1 Cloud SQL PostgreSQL

技術的には最も経験を活かしやすいが、MVP規模では常時稼働DBの固定コストが相対的に大きいため第一候補から外す。

将来Neonの制約、リージョン、運用要件等が問題になった場合は移行候補とする。

### 18.2 Firestore中心構成

Auth / PushをFirebaseへ統一できる利点はあるが、Recipe / Ingredient / Tag / RecipeTag等の関係データはPostgreSQLの方が自然である。

PostgreSQL / Prismaの既存経験もあるため採用しない。

### 18.3 Supabase中心構成

Auth / PostgreSQL / Functionsを統合できるメリットはあるが、今回の構成では既存GCP経験を活かせるCloud Run + Firebase + Neonの方を優先する。

### 18.4 React Native / Flutter

MVPはiOS専用であり、クロスプラットフォーム対応予定をMVP要件としていないため採用しない。

---

## 19. 技術検証項目

PoC 1とPoC 2、および実URLからAI解析までの統合確認は当初構成で完了した。その後YouTube取得方式をData API v3へ変更したため、**YouTube実URL経路のみ回帰PoCを再実行する**。AI Provider選定やYouTube以外の当初PoC結果は維持する。

以下のPoC 3〜6は、今回のローカル解析PoCとは分け、後続の実装・リリース工程で確認する。

### PoC 1: URL情報取得

対象サービスから最低限以下を取得できることを確認する。

- thumbnail
- source / domain
- AI入力用コンテンツ

YouTubeについては現行コードで次を再確認する。

```text
YouTube URL
→ videoId抽出
→ YouTube Data API v3 videos.list(part=snippet)
→ title / description / thumbnails取得
```

確認項目：

- 対象YouTube fixtureで必要情報を取得できる
- AI入力可能判定を維持できる
- Data API requestの取得時間
- YouTubeを含むE2EでSchema / Hallucination基準を維持できる

### PoC 2: AI構造化抽出

固定した同一テストデータ・同一期待Schemaで比較した。Z.aiを先行評価し、合格後にGemini Free Tierを比較した。OpenAIとDeepSeekは追加課金を避けるため省略した。

取得対象：

- 料理名
- 材料
- 分量
- 人数
- 調理時間
- ジャンル
- 調理手順

### PoC 3: 非同期処理

```text
API
↓
DB保存
↓
Cloud Tasks
↓
Cloud Run Worker
↓
AI解析
↓
DB更新
```

までを通しで確認する。

### PoC 4: Neon接続

Cloud Run SingaporeからNeon SingaporeへPrismaで接続し、以下を確認する。

- cold start
- pooled connection
- migration
- 通常CRUD
- 差分同期Query
- 日本からのiOS操作を含む体感Latency

### PoC 5: Authentication

- Apple
- Google
- Email / Password
- Password reset
- Firebase ID TokenをCloud Runで検証

を確認する。

### PoC 6: Push Notification

解析完了後にCloud RunからFCMを通じて実機iPhoneへ通知できることを確認する。

---

## 20. 技術選定と後続検証の完了条件

技術選定の完了には、本書の作成だけでなく、コア解析部分のPoCを必要とする。

MVPの技術選定自体は完了とする。YouTubeは公式Data APIを採用することまで確定しており、未確認なのは取得可否そのものではなく、**現行Data API経路での実URL回帰結果と取得時間の実測**である。

完了済み：

- 本書の主要技術が確定している
- YouTube以外のURL取得PoCが成立する
- AI Provider / ModelをPoC結果から決定する（Z.ai / `glm-5.3-flash`に確定）
- 当初構成で実URL → URL抽出 → AI解析 → Schema validationが成立する
- YouTubeの取得方式をYouTube Data API v3 `videos.list(part=snippet)`に確定する

後続の回帰確認：

- `YOUTUBE_API_KEY`を設定し、YouTube Data API経路の実URL取得を再実行する
- YouTube Data API経路を含むE2Eを再実行する
- Data API取得時間を記録し、実用上問題ないことを確認する

次の実環境検証は後続工程の完了条件として扱う。

- Cloud Tasks → Cloud Run Workerの非同期処理が成立する
- Cloud Run → Neon接続が実用上問題ない
- Firebase Authenticationが3方式で利用できる
- FCM → APNs通知が実機で動作する
- 想定コストがMVP方針から大きく外れない

---

## 21. 最終採用構成

現時点のMVP採用構成は以下とする。

```text
iOS
  Swift
  SwiftUI
  iOS 26+
  SwiftData
  FileManager / Application Support

Authentication
  Firebase Authentication
  Apple / Google / Email Password

Backend
  Node.js
  TypeScript
  Google Cloud Run

Content acquisition
  General Web: HTTP / JSON-LD / OGP / service-specific public metadata
  YouTube: YouTube Data API v3 videos.list(part=snippet)

Database
  Neon PostgreSQL
  Prisma

Async
  Google Cloud Tasks
  Cloud Run Worker

AI
  Provider abstraction
  Z.ai / glm-5.3-flash

Notification
  Firebase Cloud Messaging
  APNs

Observability
  TestFlight sessions / crashes / feedback

Infrastructure
  Terraform
  Secret Manager
  Artifact Registry
  GitHub Actions
```

---

## 22. 公式資料

技術選定時に確認した主な一次資料：

- Apple Xcode SDK / system requirements  
  https://developer.apple.com/xcode/system-requirements/
- Apple App Store submission requirements  
  https://developer.apple.com/news/upcoming-requirements/
- Apple SwiftData  
  https://developer.apple.com/documentation/swiftdata
- Apple Maintaining a local copy of server data  
  https://developer.apple.com/documentation/swiftdata/maintaining-a-local-copy-of-server-data
- Apple Application Support directory  
  https://developer.apple.com/documentation/foundation/url/applicationsupportdirectory
- Google Cloud Run pricing  
  https://cloud.google.com/run/pricing
- Google Cloud Tasks pricing  
  https://cloud.google.com/tasks/pricing
- Google Cloud Tasks documentation  
  https://cloud.google.com/tasks/docs
- Firebase pricing  
  https://firebase.google.com/pricing
- Firebase Authentication for Apple platforms  
  https://firebase.google.com/docs/auth/ios/start
- Firebase Authentication - Sign in with Apple  
  https://firebase.google.com/docs/auth/ios/apple
- Firebase Cloud Messaging for Apple platforms  
  https://firebase.google.com/docs/cloud-messaging/ios/get-started
- YouTube Terms of Service  
  https://www.youtube.com/static?template=terms
- YouTube Data API — Videos: list  
  https://developers.google.com/youtube/v3/docs/videos/list
- YouTube Data API — Video resource / snippet  
  https://developers.google.com/youtube/v3/docs/videos
- YouTube Data API — API request authentication  
  https://developers.google.com/youtube/v3/docs
- Neon regions  
  https://neon.com/docs/introduction/regions
- Neon connection pooling  
  https://neon.com/docs/connect/connection-pooling
- Neon compute / scale-to-zero  
  https://neon.com/docs/manage/endpoints/
- Neon pricing overview  
  https://neon.com/blog/new-usage-based-pricing
