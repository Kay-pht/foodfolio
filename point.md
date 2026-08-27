結論として、更新後の `basic-design.md`、`technology-selection.md`、`implementation-design.md`、PoC資料を再確認した結果、**前回残した5点は「4点未解決、1点は部分的に未解決」**です。

今回の「サーバー正本 + SwiftDataローカルコピー」への変更自体は整合しています。ただし、前回の5点は主に認証・外部サービス・非同期処理の問題なので、この変更では解消されていません。

| 優先度 | 指摘                                 | 現在の判定                  |
| --- | ---------------------------------- | ---------------------- |
| P0  | YouTube HTML直接取得                   | **未解決**                |
| P0  | Sign in with Apple削除時のtoken revoke | **未解決**                |
| P1  | `/v1/me` retryとUser自動生成            | **部分的に未解決**            |
| P1  | `processing`中Worker死亡時の復旧          | **未解決**                |
| P2  | AI解析の流量・コスト制限                      | **未解決。ただしMVP着手阻害ではない** |

## 1. P0 — YouTube取得方式はまだ未解決

現在のPoC資料には依然として、

> YouTubeはoEmbedに加えて、ページ内の `ytInitialPlayerResponse.videoDetails.shortDescription` を抽出する

と明記されています。

一方、更新後の技術選定書は「通常HTTP取得 → サービス別対応」としか定義しておらず、**YouTubeを公式APIに切り替えたとは書かれていません**。

YouTubeの現行利用規約は、原則としてbot・scraper等の自動手段によるServiceへのアクセスを禁止しています。 ([YouTube][1])

したがって、

```text
YouTube URL
↓
videoId抽出
↓
YouTube Data API v3
videos.list(part=snippet&id=...)
↓
title / description / thumbnails
↓
AI
```

へ明示的に変更する必要があります。

公式 `videos.list` は `snippet` からtitle・description等を取得でき、1リクエストのquota costは1 unitです。 ([Google for Developers][2])

**判定：未解決です。**

---

## 2. P0 — Appleアカウント削除時のtoken revokeも未解決

更新後の実装設計書ではアカウント削除について、

* Firebase Authentication User
* DBデータ
* SwiftData
* RecipeImages
* cursor等

を削除すると定義されていますが、**Sign in with Appleのtoken revoke手順がありません**。

Firebase公式ドキュメントでは、Sign in with Appleユーザーの削除時には、

```text
Appleで再認証
↓
authorization code取得
↓
Auth.auth().revokeToken(withAuthorizationCode:)
↓
Firebase User / associated data削除
```

が必要とされています。FirebaseはApple tokenを保持していないため、削除時の再認証も必要です。 ([Firebase][3])

したがって、少なくともApple providerを含むアカウントについてこのフローを追加する必要があります。

**判定：未解決です。**

---

## 3. P1 — `/v1/me` retry問題は「矛盾」から「仕様不足」に変わった

以前より少し改善しています。

現在の実装設計書では、APIの責務として、

> Firebase ID Token検証
> User作成 / 解決

が残っています。

一方、アカウント削除については、

> Backend DB削除とFirebase User削除は単一transactionにできないため、再試行可能な設計を維持する

までしか定義されていません。

つまり以前あった、

```text
DB削除
↓
Firebase削除失敗
↓
再試行
↓
Userがないので自動再作成
```

という具体的な処理順は文書から消えています。

そのため、**「現在必ず再生成バグが起きる」とは言えなくなりました**。

ただし、

```text
DELETE /v1/me の場合、
UserがDBに存在しなくてもauto-provisionしてはいけない
```

という例外ルールも書かれていません。

したがって、

```text
通常API
→ Firebase UIDでUser解決
→ なければ作成

DELETE /v1/me
→ Firebase UIDでUser lookup only
→ DB Userがなくても作成しない
→ Firebase削除/revoke処理へ進む
```

と明記するのが安全です。

**判定：部分的に未解決です。以前の明確な矛盾は消えたが、retry時の挙動が未定義です。**

---

## 4. P1 — `processing`中にWorkerが死ぬ問題は未解決

これはそのまま残っています。

現在の実装設計は、

```text
completed -> 何もしない
failed -> 何もしない
pending / processing -> 処理候補
```

とし、

> status compare-and-setまたはDB transactionで多重実行を制御する

としています。

しかし、

```text
pending
↓
Worker Aがprocessingへ変更
↓
AI呼び出し
↓
Worker A死亡
```

した後の復旧方法がありません。

Cloud Tasksは重複実行が発生し得ると公式にも明記されています。 ([Google Cloud Documentation][4])

また、今回 `analysisAttemptCount` を削除してCloud Tasksのretry headerへ寄せたこと自体は問題ありません。Cloud Tasksは `X-CloudTasks-TaskRetryCount` と `X-CloudTasks-TaskExecutionCount` を送ります。 ([Google Cloud Documentation][5])

ただし、それは**試行回数の取得方法を解決しただけで、「誰が現在の処理権を持っているか」は解決していません。**

MVPなら例えば、

```text
Recipe
- processingRunId
- processingStartedAt
```

程度を追加して、

```text
pending
↓
runId=Aでclaim

processingが一定時間以上古い
↓
stale扱い
↓
runId=Bで再claim

結果書き込み
↓
現在のrunIdと一致する場合のみcommit
```

で十分です。

`processingRunId` を永続カラムに増やしたくなければ、別のAnalysisJobテーブル等でも構いません。ただし何らかのlease / generation機構は必要です。

**判定：未解決です。**

---

## 5. P2 — AI処理の流量制限もまだ未解決

現在、

* 保存件数制限なし
* Recipe保存ごとにCloud Task作成
* retryはCloud Tasks管理

という設計ですが、Queueの、

```text
maxConcurrentDispatches
maxDispatchesPerSecond
```

等の初期値は定義されていません。

Cloud TasksにはQueue側でretry・dispatch rate・concurrencyを設定する仕組みがあります。 ([Google Cloud Documentation][6])

ただしこれは、想定最大10ユーザーのMVPなら**設計完了を止めるほどではありません**。

実装時に例えば、

```text
maxConcurrentDispatches = 2〜3
```

程度をTerraformで設定すれば十分です。

**判定：未解決ですがP2のままでよいです。**

---

## 追加レビューで1点だけ新たに気になる箇所

今回導入した差分同期について、**RecipeとTagを1つのsync cursorでどう扱うかがまだ曖昧**です。

現在の `/v1/sync` は、

```json
{
  "recipes": [],
  "tags": [],
  "nextCursor": "..."
}
```

を返します。

ところがcursorについては、

> `updatedAt` と安定tie-breakerを基準に生成

とされています。

一方でTagには `updatedAt` がなく、

```text
Tag
- id
- userId
- name
- normalizedName
- createdAt
```

だけです。

つまり、

```text
Recipe差分 → Recipe.updatedAt
Tag差分    → Tag.createdAt
```

という**2種類のwatermark**があります。

これは実装前に、

```text
syncCursor内部
- recipeUpdatedAt
- recipeId
- tagCreatedAt
- tagId
```

のように複数watermarkを持たせる、とだけ決めておくのが最も簡単です。Clientには従来どおりopaque stringとして返せます。

これは今回のローカル同期設計で新たに発生した、**P1寄りの修正推奨事項**です。

## 最終判定

現状、実装前に確実に直した方がよいのは以下の **4点**です。

1. **YouTube取得をYouTube Data APIへ明示的に変更**
2. **Sign in with Apple削除時の再認証 + token revokeを追加**
3. **`DELETE /v1/me` はUser auto-provision対象外と明記**
4. **Workerのprocessing lease / stale recoveryを定義**

加えて今回の同期設計について、**sync cursorでRecipeとTagのwatermarkをどう保持するか**も決めておくことを推奨します。

AI処理のrate limitは実装時にTerraformへ設定すればよく、現時点で実装開始を止める問題ではありません。

[1]: https://jp.youtube.com/t/terms?utm_source=chatgpt.com "Terms of Service"
[2]: https://developers.google.com/youtube/v3/docs/videos/list?utm_source=chatgpt.com "Videos: list  |  YouTube Data API  |  Google for Developers"
[3]: https://firebase.google.com/docs/auth/ios/apple?utm_source=chatgpt.com "Authenticate Using Apple  |  Firebase"
[4]: https://docs.cloud.google.com/tasks/docs/common-pitfalls?authuser=2&utm_source=chatgpt.com "Issues and limitations  |  Cloud Tasks  |  Google Cloud Documentation"
[5]: https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks?authuser=7&utm_source=chatgpt.com "Create HTTP target tasks programmatically  |  Cloud Tasks  |  Google Cloud Documentation"
[6]: https://docs.cloud.google.com/tasks/docs/configure-retry-task?hl=en&utm_source=chatgpt.com "Set retry parameters for a task  |  Cloud Tasks  |  Google Cloud Documentation"
