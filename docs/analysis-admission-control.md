# 解析依頼の受付制御

## 目的

`POST /v1/recipes` で認証済みユーザーが解析依頼を無制限に積めないようにし、AI費用と解析待ち時間の増大を防ぐ。

## 上限

| 種別                      |       上限 |
| ------------------------- | ---------: |
| ユーザー1人あたり未処理   |       10件 |
| ユーザー1人あたり新規解析 |  30件 / 日 |
| ユーザー1人あたり新規解析 | 100件 / 月 |
| システム全体の未処理      |      100件 |
| システム全体の新規解析    | 500件 / 日 |

日次上限の1日は **00:00〜23:59 JST** とする。月次上限の1か月は **毎月1日 00:00 JST〜翌月1日 00:00 JST未満** とする。DBの日時自体は従来どおりUTCで保存する。

Kill Switchは設けない。

## 受付フロー

```text
認証
↓
URL validation / normalization
↓
同一Userの重複確認
↓
DB transaction開始
↓
PostgreSQL transaction-level advisory lock取得
↓
ユーザー未処理 < 10
↓
ユーザー当日受付 < 30
↓
ユーザー当月受付 < 100
↓
全体未処理 < 100
↓
全体当日受付 < 500
↓
Recipe + AnalysisAdmission作成
↓
commit
↓
Cloud Tasks enqueue
```

どれかの上限に達した場合はRecipeを作成せず、`429 ANALYSIS_LIMIT_EXCEEDED` を返す。

## AnalysisAdmission

解析受付はRecipeとは別の `AnalysisAdmission` に記録する。

- `acceptedAt`: 受付日時。日次・月次上限の集計に使用する
- `finishedAt`: nullの間は未処理枠として数える
- `recipeId`: 対象Recipe ID
- `userId`: 対象User ID

`recipeId` は意図的にRecipeへの外部キーにしない。解析中Recipeを削除しても、既にCloud Tasksへ投入された解析受付まで消して未処理上限を回避できないようにするためである。

User削除時は `userId` の外部キーにより受付履歴もcascade deleteする。

## 未処理枠を解放するタイミング

- Cloud Tasks enqueueに失敗したとき
- Workerが解析成功で終了したとき
- Workerが最終失敗で終了したとき
- Recipeが先に削除済みなど、Workerが再試行不要と判断したとき

Workerが再試行を要求する間は `finishedAt` を設定しない。

日次・月次上限は解析成功数ではなく **受付数** を数える。enqueue失敗や解析失敗でも `AnalysisAdmission` 自体は残すため、失敗を利用して上限を回避できない。

## 並行リクエスト

受付判定とRecipe作成は同じDB transaction内で行い、PostgreSQLのtransaction-level advisory lockで受付のcritical sectionを直列化する。

APIが複数Cloud Run instanceで動作していても、プロセス内メモリのカウンターには依存しない。
