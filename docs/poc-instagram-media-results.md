# Instagram Media Retrieval PoC 結果

## 1. 目的

Foodfolioが、ユーザーから共有された公開Instagram投稿URLから、AI解析に必要な画像・動画を匿名アクセスで取得できるかを確認する。

対象は以下の投稿形式とした。

- Reel
- 通常の単一動画投稿
- 単一画像投稿
- 画像カルーセル
- 画像 + 動画の混在カルーセル

このPoCはレシピ抽出精度そのものではなく、Instagram投稿からAIへ渡せるメディア本体を取得できるかを検証対象とした。

## 2. 背景と採用候補

Foodfolioのユースケースでは、投稿者本人によるFoodfolioへのInstagram認証を前提にせず、ユーザーが見つけた任意の公開投稿URLを解析する必要がある。

そのため、投稿者や対象アカウントの認証を前提とするInstagram公式APIだけでは今回の取得フローを満たせないと判断し、既にTikTok動画取得で利用している`yt-dlp`を第一候補として検証した。

Instagram画像について、`yt-dlp`は本来動画・音声取得を主目的とするが、`--ignore-no-formats-error`を利用すると画像投稿でもmetadataを取得できる場合がある。PoCではmetadata内の画像候補URLを取得し、そのURLから画像を直接HTTPダウンロードする方式を確認した。

PoC実装・試行錯誤の履歴はGitHub PR #64に残す。PoCコード自体はproductionへマージせず、本書に検証結果と採用判断だけを残す。

- Historical PoC PR: https://github.com/Kay-pht/foodfolio/pull/64

## 3. 検証環境

- 実施日: 2026-09-07
- Node.js: `24.18.0-slim`
- `yt-dlp`: `2026.08.19`
- 実行方式: Docker
- 認証: Instagram Cookie / ログインなし
- リトライ: ケースごとに上限を設定。ただし最終成功ケースはすべて初回試行で成功
- Cloud Runとの差を減らすため、production runtimeと同系統のNode 24 slim環境を利用

PoCのraw artifact、Instagram画像・動画、`yt-dlp`のraw JSON、時限的なCDN URLはGitへ永続保存しない。

## 4. production採用条件

以下の5種類すべてについて、現在匿名閲覧できる有効な公開投稿でメディア取得に成功することを採用条件とした。

1. Reel
2. 通常動画
3. 単一画像
4. 画像カルーセル
5. 画像 + 動画の混在カルーセル

各ケースの成功条件は以下。

1. `yt-dlp`で投稿metadataを取得できる
2. 投稿種別を期待どおり判定できる
3. カルーセルでは全entryを元の順序で列挙できる
4. 各entryから画像または動画の取得先を得られる
5. 各メディアを匿名アクセスで実ファイルとして取得できる
6. 取得ファイルが空でなく、PoCのサイズ上限内である

## 5. 最終結果

最終PoCはproduction採用条件を満たした。

- PASS: **6**
- FAIL: **0**
- INCONCLUSIVE: **0**
- exit code: **0**
- 全ケース初回試行で成功

| ケース | 結果 | 実取得 |
| --- | --- | --- |
| Reel | PASS | 動画 1/1 |
| 通常動画 | PASS | 動画 1/1 |
| 単一画像 A | PASS | 画像 1/1 |
| 単一画像 B | PASS | 画像 1/1 |
| 画像カルーセル | PASS | 全画像取得成功 |
| 画像 + 動画の混在カルーセル | PASS | 全メディア取得成功 |

投稿本文にレシピ本文・作り方が存在するかどうかは、このPoCのメディア取得判定には影響させていない。

画像投稿では`yt-dlp`が「動画formatが存在しない」旨の警告を出す場合があるが、画像metadataと画像本体を取得できている場合は想定内として扱った。

## 6. 採用判断

Instagram media fallbackのproduction実装へ進む。

現時点の実装方針は以下を第一候補とする。

### Video / Reel

1. Instagram URLを受け取る
2. `yt-dlp`から動画metadata / video formatを取得する
3. 動画を一時ダウンロードする
4. AI動画解析へ渡す
5. 一時ファイルを削除する

### Image

1. Instagram URLを受け取る
2. `yt-dlp --ignore-no-formats-error`相当でmetadataを取得する
3. 対象entryの画像候補から解析用画像URLを決定する
4. 画像を一時取得する
5. AI画像解析へ渡す
6. 一時ファイルを削除する

### Carousel

- entry順序を保持する
- 画像と動画を区別する
- mixed carouselでは画像・動画を同一投稿の順序付きメディアとしてAI解析へ渡す
- 一部entryだけ取得できた状態を成功扱いにしない

## 7. production実装への引き継ぎ

PoCコードをそのままproductionへ移植しない。

production側では既存TikTok fallbackとの重複を避け、メディア取得境界を適切に共通化する。PoC固有のrunner、専用Dockerfile、公開サンプルcase、PoC専用unit testはproduction実装へ持ち込まない。

production実装では少なくとも以下をテストする。

- Reel動画
- 通常動画投稿
- 単一画像
- 複数画像カルーセル
- 画像 + 動画のmixed carousel
- entry順序保持
- 一部取得失敗時のfailure処理
- size / timeout制限
- 一時ファイルcleanup
- 既存TikTok / YouTube経路への回帰がないこと

実装完了後にlive検証が必要になった場合は、PoCコードを残すのではなく、productionのmedia retrieverを直接呼ぶ診断用commandを用意する。

## 8. 制約とリスク

このPoC成功は、Instagram側の将来仕様変更に対する恒久的な互換性を保証しない。

特に以下は継続リスクとして扱う。

- Instagram側のWeb/APIレスポンス変更
- `yt-dlp` Instagram extractorの仕様変更
- 匿名アクセスへのrate limit / bot対策
- Cloud Runの送信元IP等による環境差
- 公開投稿の削除・非公開化
- CDN URLやmedia metadataの構造変更

private投稿、ログイン必須投稿、年齢・地域制限の回避はMVP対象外とする。

## 9. Git上の保持方針

mainへ残すのは本書とproduction実装・production testのみとする。

以下は永続保存しない。

- `poc/instagram-media/` のPoC実行コード
- PoC専用Dockerfile / runner
- PoC専用case file
- raw `result.json`
- raw `yt-dlp.json`
- Instagramから取得した画像・動画
- 時限的なmedia URL

PoCの実験履歴を確認したい場合は、closed PR #64を参照する。
