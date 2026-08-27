# foodfolio MVP 技術選定書

## 1. 本書の目的

本書は、foodfolio MVPを実装するために採用する技術スタックと、その選定理由、制約、技術検証方針を明確にする。

対象は以下とする。

- iOSアプリ
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
| IaC | Terraform | 採用 |
| Secrets | Google Cloud Secret Manager | 採用 |
| Crash Reporting | Firebase Crashlytics | 採用 |
| Analytics | Firebase Analytics | 採用 |
| 画像Storage | MVP初期は専用Storageを持たない | 条件付き |

---

## 4. 全体構成

```text
┌──────────────────────────────┐
│ iOS App                      │
│ Swift / SwiftUI / iOS 26+    │
└──────────────┬───────────────┘
               │
               │ Firebase Authentication
               │ ID Token
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
└──────────────┘          │ authenticated HTTP
                          ▼
                 ┌─────────────────┐
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
- Auth: Firebase Authentication SDK
- Push: Firebase Messaging SDK
- Crash: Firebase Crashlytics
- Analytics: Firebase Analytics

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

### 7.3 Prisma

ORMはPrismaを採用する。

Cloud Runのようにインスタンス数が変動する環境では、Neonのpooled connection stringを利用する。

DB migrationについてはPrisma Migrateを利用する。

### 7.4 Search

MVPでは外部検索サービスを導入しない。

PostgreSQL上で以下を実現する。

- 料理名の部分一致
- 材料名の部分一致
- ジャンル絞り込み
- タグ絞り込み
- 上記条件の組み合わせ

MVP規模ではAlgolia、Elasticsearch、OpenSearch等は導入しない。

検索性能または日本語検索品質に問題が出た場合のみ、PostgreSQL拡張や専用検索基盤を再検討する。

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

- Provider: Z.ai
- Model: `glm-5.3-flash`
- API: Chat Completions JSON mode
- Backend側でRecipe Schema validationを必須とする

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

URL取得方式はPoCで確定する。

最初からHeadless Browserのみへ依存しない。

基本方針：

1. 通常HTTP取得
2. HTML metadata / OGP / JSON-LD等の機械取得可能情報を利用
3. AI入力に必要な本文情報を抽出
4. 通常取得で不足するサービスのみ個別対応を検討
5. JavaScript実行が不可欠な場合のみHeadless Browserを検討

YouTube、Instagram、TikTok等は一般Webページと取得条件が異なるため、サービスごとの実現可能性をPoCで確認する。

利用規約・API仕様・アクセス制限を無視した実装は採用しない。

### PoCで確認すること

- title相当情報を取得できるか
- thumbnail / OGP画像URLを取得できるか
- AIへ渡せる本文情報を取得できるか
- JavaScript実行が必要か
- ログイン必須ページをどう扱うか
- rate limit / bot対策等により安定取得できないケースが何か

---

## 12. 画像

MVP初期では、画像保存専用のCloud Storageを必須構成にしない。

まずは元ページから取得できた代表画像URLをRecipeデータとして保持し、iOSから表示する方式でPoCする。

以下の問題が確認された場合にのみGoogle Cloud Storage等へのキャッシュを追加する。

- source側URLの有効期限が短い
- hotlinkが禁止・不安定
- 表示速度が著しく悪い
- 認証付きURLでiOSから直接取得できない

これにより、MVP初期の構成と費用を抑える。

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

MVPの外部TestFlight検証では以下を利用する。

- Firebase Crashlytics
- Firebase Analytics

目的：

- クラッシュ把握
- 主要操作が正常に利用されているかの把握
- MVPユーザー検証時の最低限の利用状況確認

詳細なイベント設計はTestFlightリリース準備工程で行う。

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
- Crashlytics / AnalyticsはMVPで利用しやすい無料サービスとして利用する

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

Auth / PushをFirebaseへ統一できる利点はあるが、Recipe / Ingredient / Tag / RecipeTag等の関係データと複合検索はPostgreSQLの方が自然である。

PostgreSQL / Prismaの既存経験もあるため採用しない。

### 18.3 Supabase中心構成

Auth / PostgreSQL / Functionsを統合できるメリットはあるが、今回の構成では既存GCP経験を活かせるCloud Run + Firebase + Neonの方を優先する。

### 18.4 React Native / Flutter

MVPはiOS専用であり、クロスプラットフォーム対応予定をMVP要件としていないため採用しない。

---

## 19. 技術検証項目

PoC 1とPoC 2、および実URLからAI解析までの統合確認は完了した。以下のPoC 3〜6は、今回のローカル解析PoCとは分け、後続の実装・リリース工程で確認する。

### PoC 1: URL情報取得

対象サービスから最低限以下を取得できることを確認する。

- thumbnail
- source / domain
- AI入力用コンテンツ

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
- 検索Query
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

技術選定の完了条件は次のとおりで、すべて完了した。

- 本書の主要技術が確定している（完了）
- URL取得PoCが成立する（完了）
- AI Provider / ModelをPoC結果から決定する（Z.ai / `glm-5.3-flash`に確定）
- 実URL → URL抽出 → AI解析 → Schema validationが成立する（完了）

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

Authentication
  Firebase Authentication
  Apple / Google / Email Password

Backend
  Node.js
  TypeScript
  Google Cloud Run

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
  Firebase Crashlytics
  Firebase Analytics

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
- Neon regions  
  https://neon.com/docs/introduction/regions
- Neon connection pooling  
  https://neon.com/docs/connect/connection-pooling
- Neon compute / scale-to-zero  
  https://neon.com/docs/manage/endpoints/
- Neon pricing overview  
  https://neon.com/blog/new-usage-based-pricing
