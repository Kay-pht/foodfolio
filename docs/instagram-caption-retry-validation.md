# Instagram caption優先・再試行の追加検証

以下は2026-10-08の追加検証記録。末尾のmain向けの整理を除き、PR準備前の実施範囲と結果を記載する。

実験時の仕様ID: `INSTAGRAM-ROUTING-RETRY-VALIDATION-001`。2026-10-08 JST、`codex/instagram-media-completion`、ベースHEAD `dc91868539c314f73c660b00771add53e95c7116`。ローカル候補実装を検証し、デプロイ・push・PR作成は行わない。

## 方針と現行実装の相違

①＋②という優先順位は維持する。ただし、追加する実装と既存の挙動を区別する。

- Z.aiの`AI_TIMEOUT`、`AI_SCHEMA_INVALID`、`AI_INVALID_JSON`は既にretryable。Workerは途中の失敗をpending/HTTP503、最終失敗をfailed/HTTP204にする。内部に別のAI再試行ループは追加しない。
- 稼働中Workerの`MAX_ANALYSIS_ATTEMPTS=3`と、実際のCloud Tasksキューの最大3回・backoff 5〜60秒をread-backした。
- Instagramのcaptionは既にJevで分類され、`p(recipe) >= 0.99`ならtext、未満ならmedia。text抽出後の材料・手順が不十分ならmediaへ進む。
- Jevの確率はレシピらしさであり、captionの充足度を保証しない。材料の一部欠落を新しい失敗条件にはしない。
- 追加検証でInstagram textの4000打ち切りも再現したため、候補変更をInstagram text/media両方の10000/lowに広げた。他媒体のtext/mediaは4000/effort未指定を維持する。routingやretry処理を変更する根拠は得られていない。

前回のメディアルート固定15回は[前回報告](instagram-media-completion-validation.md)を参照。11/15は単発リクエストの成功率であり、再試行込みの本番完了率ではない。

## 入力とルーティング

前回の5投稿を使用する。まず保存済みcaptionで実Jevを5回呼び、その後、現行`ProductionSourceContentExtractor`で5投稿を再取得した。再取得は全件成功し、材料・工程がある4投稿ではそれらが取得したtextに残っていた。新旧入力は長さとhashが異なるため、同一入力とは扱わない。

| 投稿             | 保存済みcaptionのJev | 再取得入力のJev | 実行する経路 |
| ---------------- | -------------------- | --------------- | ------------ |
| 米粉ドーナツ     | p=1.00               | p=1.00          | text         |
| 鶏肉となす       | p=1.00               | p=1.00          | text         |
| きのこマリネ     | p=1.00               | p=1.00          | text         |
| ほうれん草       | p=1.00               | p=1.00          | text         |
| 元のにんじん投稿 | p=0.41               | p=0.42          | media        |

Jev入力、モデルとthresholdは現行コードと同じ。初期probeとは別に、各Worker配信でも実際にJevを呼ぶ。メディアは前回とSHA256が同じ動画1本を使う。投稿取得、GCS公開、通知、Cloud Tasksスケジューラーと実端末はローカルWorkerの測定範囲に含めない。

## 実API結果

最初の保存済みcaptionによる4件はtextだけで完了し、保存・API取得・重複配信を通過した。所要時間は24.390〜58.288秒。元のにんじん投稿のmediaは120.003秒でtimeoutし、pending/HTTP503になった。

usage不明の最大費用予約により、次のAI送信前に検証を中断した。予算ガードによる中断はproviderの2回目のtimeoutではない。2回目の配信はJevだけを呼び、Z.aiへは送信していない。最終失敗通知も送っていない。

課金照合後、ローカルDBに中断時のpending状態を復元し、retry count=1から続きを測る。この再開は予算確認による中断を含むため、連続した本番再試行の時間や本番完了率の実測とは扱わない。その後の再取得入力による検証は、別の新規ジョブとして分ける。

にんじんの再開呼び出しは25.463秒で成功し、保存・API取得・重複配信を通過した。途中の予算確認を含む5件と、以降の連続ジョブは集計を分ける。

再取得したドーナツ入力では、従来のtext設定で3回とも`finish_reason=length`・output4000・`AI_INVALID_JSON`になった。Workerは3回目でfailed/HTTP204へ到達し、全体214.362秒。現行の再試行だけで打ち切りが解消するとはいえない。鶏肉の再取得入力は45.193秒で成功した。取得済みcaptionだけの結果から本番相当入力の安定性を判断できないことを実測で確認した。

この再現を受け、仕様を更新し、Instagram textでも10000/lowを要求する回帰テストが変更前に失敗することを確認してから修正した。入力、prompt、Jev、schema、retry countは変更せず、同じ再取得入力を固定して候補を再評価する。

### 最終候補: 再取得入力による5投稿×3ジョブ

15/15ジョブがcompletedになり、保存・API取得・完了後の重複配信確認まで通過した。text12ジョブは全て1回、media3ジョブは1回/2回/2回で成功した。mediaの後半2件の再試行は同じWorker・DBを維持した連続測定で、予算確認による中断を挟んでいない。

| 投稿             | 経路  | 1回目のジョブ   | 2回目のジョブ    | 3回目のジョブ    |
| ---------------- | ----- | --------------- | ---------------- | ---------------- |
| 米粉ドーナツ     | text  | 9.043秒・1試行  | 8.165秒・1試行   | 7.642秒・1試行   |
| 鶏肉となす       | text  | 6.169秒・1試行  | 7.840秒・1試行   | 6.818秒・1試行   |
| きのこマリネ     | text  | 4.691秒・1試行  | 3.729秒・1試行   | 3.542秒・1試行   |
| ほうれん草       | text  | 5.381秒・1試行  | 5.929秒・1試行   | 4.585秒・1試行   |
| 元のにんじん投稿 | media | 18.695秒・1試行 | 239.451秒・2試行 | 149.868秒・2試行 |

Z.aiは17回呼び、15回成功・2回timeout。単発成功率は15/17（88.2%）、今回のローカルジョブ完了率は15/15。両者を混同しない。受領した15応答は全てHTTP200・`finish_reason=stop`・schema有効で、出力196〜527 tokens。timeoutの2応答は受領していないため、そのprovider側の終了理由は不明。観測した打ち切り/schema不一致は0件。

textのジョブ中央値は6.049秒、範囲3.542〜9.043秒。全ジョブ中央値は6.818秒だが、mediaは再試行込み最大239.451秒で、timeout自体は残った。機械・ネットワーク・時間帯・cache条件まで揃えた因果推定ではなく、今回の固定入力での観測値である。本番の新規取得・Cloud Tasks配送・端末表示・実通知を含む完了率は未測定。

繰り返しrunnerはRecipeのユーザー/URL重複制約とDeviceTokenのunique制約で停止したため、テスト用ユーザーとtokenを試行ごとに分けた。完了済みcase/repetitionをskipして残りだけ再開し、15組の重複なし、source hash一致をauditした。DB fixture作成段階の失敗をAI失敗件数へ含めない。

### 品質

全15出力を参照と照合し、空でないtitle・材料・手順を確認した。caption4投稿の12出力は参照中の主要材料名を保持した。きのこの1出力は醤油/酢/ごま油を1欄へまとめている。きのこ/ほうれん草の手順には、材料欄と対応付けられていない調味料グループ記号が残る。

にんじん3出力は全てにんにくが欠落し、1件はにんじんの数量がnull。2件に根拠未確認の液体調味料「小さじ1」があり、2件の総調理時間5分と1件の加熱手順5分は、販促captionには記載があるが、媒体から具体的な加熱条件や総調理時間を独立に確認できていない。調味料・仕上げの緑色素材の同定にも不確実性がある。完了率と完全な忠実度は別であり、これらを追加の失敗・再試行条件にはしない。

## 費用と一時権限

今回の別枠予算は50円。予算換算は200円/USD。[Z.ai公式単価](https://docs.z.ai/guides/overview/pricing)の入力$0.15/M、出力$0.50/Mを使用し、cache割引を適用せずに予約する。未知入力は1M、既知の同じrequest hashは最大実測入力の2倍、出力は設定上限を予約する。timeoutのusageは受領応答と課金照合を区別して記録する。

[Jev公式単価・context上限](https://docs.typesafe.ai/models)は入力$0.042/M・出力無料・64k/request。[公式応答usage](https://docs.typesafe.ai/api)が保存された呼び出しはusageで精算し、保存されなかったprobe/初期呼び出しは64kの予約を保持する。

初期Z.aiの5回分の課金10行がPaidになった。既知4回の入力/出力usageと、同一API keyの5回分の行数を照合し、時間帯のWorker解析ログは0件だった。同じkeyの同時間帯の全課金を含めて$0.00997184。timeout相当の2行は入力31610/output366・$0.0049245で、これを費用予約の精算に使った。タイムスタンプとusageによる照合であり、request IDでの直接照合ではない。UI日時はUTC+8として既知呼び出しと整合するが、timezoneは画面に明示されていない。

timeoutの結果は変更せず、費用予約は38.8271円から8.8120円へ更新した。媒体転送・短期保存・操作の余裕枠も含め、以降も送信前に予算を検査する。これは請求書の最終実額ではない。

baselineの停止時に次のきのこ呼び出しが開始済みだったため、送信済みか不明な呼び出しの最大費用予約も保持した。課金確認では同時間帯の同一keyに対応を断定できない1呼び出し分も含まれていた。個別の成功として扱わず、それ以降の同一keyの全課金$0.01580069を保守的に追加集計した。既に数えた呼び出しの二重計上も保持し、候補開始前の費用上限集計は15.7236円。中断されたきのこを成功件数へは含めない。

署名権限は同じWorker SAに55分の条件付きbindingで付与し、動画1本の署名後に早期解除した。IAMがbaselineに戻ったことと、署名GETの動画SHA256一致を確認済み。検証後に実験所有objectの同じgenerationだけを削除した。

最終費用集計は**30.3371円**。前半の比較と中断分、同一keyの未対応課金の保守的な追加集計、未精算timeout2件の予約、Jevと媒体の余裕枠を含む。50円以内で終了した。実験objectはgeneration・MD5・size・nameを再照合して1件だけ削除し、署名GETのHTTP404、最終IAMのbaseline一致を確認した。

## 採用方針

Instagram text/mediaの10000/low＋現行caption優先ルーティング＋既存の最大3回のCloud Tasks再試行を採用候補として推奨する。caption側の4000を残すと、今回のドーナツのように再試行だけでは復旧しない。routingや再試行回数の追加変更は不要。

今回の15ジョブでは分析失敗を回避できたが、一般の投稿・本番での失敗解消を保証する結果ではない。③の入力削減は、残るmedia timeoutと最大約4分の処理時間を短くする次の比較候補とする。schema緩和や別モデルfallbackを急いで追加する根拠は今回は得られていない。デプロイは行っていない。

## ローカル検証

既存処理を直接通すE2Eを8ケース補強し、`tests/e2e/instagram-media-completion.test.ts`の計11ケースが成功した。Instagram textの設定回帰は変更前RED、変更後GREEN。非InstagramのWeb/YouTube/TikTok text設定が維持されることも検証する。

- timeout/schema不一致の後に成功し、2回目または3回目でcompletedになる。
- timeout/schema不一致が3回続くとfailedになり、最終失敗通知は1回だけ。
- HTTP400の恒久的拒否は再試行しない。
- 中間失敗時は材料・手順を保存せず、leaseを解除してpendingになる。
- 1配信につきAI呼び出し1回。完了/最終失敗後の重複配信でAIを追加呼び出ししない。
- Jevのtext判定後、完成したtextならmediaを呼ばず、不完全なtextならmediaへ進む。

`npm run verify`は成功。unit477、integration58、E2E63、format、lint、build、Prisma、spec/P0、architecture、docs、task整合を通過した。iOS/API契約変更がないため、iOS検証は[検証ルール](agent/testing.md)により対象外。

追加の`tsc --noEmit`は、HEADから未変更の既存20ファイルに51件の型エラーが残るため失敗した。今回変更したproduction/testファイルと今回の補助runnerには型エラーがない。必須のproduction buildは成功している。追加型検査まで含めたリポジトリ全体の型問題が解消したとは扱わない。

証拠はGit管理対象外の`poc/artifacts/instagram-routing-retry-20261008/`。秘密情報・署名URL・caption全文・raw reasoningは公開報告に含めない。`tasks/todo.md`に対応項目はなく、無関係なチェックリストは変更していない。

## main向けの整理

2026-10-09、現行候補実装をmain向けPRへ整理する。実験時の3仕様は[INSTAGRAM-MEDIA-COMPLETION-001](../specs/tasks/INSTAGRAM-MEDIA-COMPLETION-001.yaml)に統合し、Instagram text・ordered media・legacy videoへ`max_tokens: 10000`と`reasoning_effort: low`を適用する。既存のcaption優先ルーティング、最大3回のCloud Tasks配送再試行、prompt・schema・120秒timeoutは維持する。

前段階の採用保留は、その時点の観測結果として上記の報告に残す。最終候補の根拠は、この文書の再取得入力5投稿×3ジョブで15/15完了した測定と、従来のcaption設定で同じ入力が3回とも4000 tokensで打ち切られた再現である。media timeoutや材料欠落が解消したとの主張はしない。

今回だけの比較・費用予約・再開runnerである`poc/ai-output-budget/`と、その専用テスト2ファイルは削除する。本番設定を検証するunit testと、Worker・Postgres・APIを通すE2Eは維持する。3段階の検証報告とGit管理対象外の入力・結果・課金照合等は保持し、追加の有料API呼び出しは行わない。

配布状況は[tasks/unreleased.md](../tasks/unreleased.md)の`REL-20261009-01`に記録する。PR準備ではデプロイ・最終LGTM・マージを実行しない。mainへマージ後は既存のQuality成功を起点としたdevデプロイ対象となるため、稼働revisionへの反映確認は別途必要。
