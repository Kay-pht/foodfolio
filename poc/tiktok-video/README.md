# TikTok video download PoC

## 目的

Foodfolioでユーザーが保存した公開TikTok URLから、動画ファイルを技術的に取得できるかをローカル環境で確認するPoCです。

このPoCの方式は、タイトルだけでは材料・手順を作れない場合の動画フォールバックとして本番コードへ採用します。書面許可を確認したdev環境では機能フラグを有効化します。新しい環境の既定値は無効のままとし、許可範囲を確認してから環境ごとに有効化します。

TikTok公式APIでは任意の第三者投稿のMP4ダウンロードURLは提供されていないため、動画取得には非公式のWeb抽出方式であるyt-dlpを利用します。

## 実行

書面許可を確認した公開TikTok URLに対して、以下の手順で再検証できます。

リポジトリルートで次を実行します。

```bash
npm run poc:tiktok-video
```

既定では3件のTikTokレシピURLを順番に検証し、すべてのURLについてMP4を一時ダウンロードします。全URLの取得に成功した場合だけPoC成功とします。

各URLでは次の方式を使います。

1. メタデータ抽出とMP4ダウンロードを1つのyt-dlpプロセスで実行する
2. 失敗した場合は、新しいyt-dlpプロセスでchallenge取得からやり直す
3. 既定ではURLごとに初回を含めて最大5回まで限定試行する

以前のPoCはメタデータ確認後のダウンロード時に同じURLを再抽出していたため、1回目が成功しても2回目の一時的なWeb抽出失敗で動画取得に失敗しました。現在は`--write-info-json`とMP4ダウンロードを同じ呼び出しで行い、この二重抽出を避けています。

特定URLだけを試す場合:

```bash
npm run poc:tiktok-video -- 'https://www.tiktok.com/@USER/video/VIDEO_ID'
```

チャット等からMarkdown形式のリンクをそのまま貼った場合も、`[URL](URL)` から実URLを自動抽出して検証します。ただし、可能なら上記のように生URLだけを渡してください。

## 必要環境

- macOS または Linux
- Node.js 24以上
- curl

`yt-dlp` はPoC実行時に `2026.08.19` のバイナリを一時ディレクトリへダウンロードするため、事前インストールは不要です。

`ffprobe` がある場合は、ダウンロードしたMP4について映像・音声codec、解像度、長さ、サイズまで確認します。macOSで未導入の場合は以下で追加できます。

```bash
brew install ffmpeg
```

`ffprobe` がなくても、MP4の取得可否そのものは検証できます。

## `Unable to extract universal data for rehydration` が出る場合

これはMP4ダウンロード以前に、yt-dlpがTikTokのWebページから動画情報を取得できなかった状態です。PoCはchallenge cookieを使い回さず、新しいyt-dlpプロセスでURL全体の取得を再試行します。

最大試行回数を変える場合:

```bash
TIKTOK_POC_MAX_ATTEMPTS=3 npm run poc:tiktok-video
```

リトライ間隔は既定で`2秒、4秒、6秒、8秒、以後10秒`です。基準秒数を変える場合は`TIKTOK_POC_RETRY_BASE_SECONDS`、上限秒数を変える場合は`TIKTOK_POC_MAX_RETRY_SECONDS`を指定します。

## Cookieを必要とするURL

Cookieが必要なURLは本番対応対象外です。本番WorkerはCookieを使用せず、ログイン要求、年齢制限、地域制限、非公開投稿を回避しません。

PoCには許可済みコンテンツの調査用として、ローカルブラウザCookieを渡す機構だけを残しています。ただし本番WorkerではCookieを使用しません。Cookieをリポジトリやログへ保存しないでください。

Chromeの場合:

```bash
TIKTOK_POC_COOKIES_FROM_BROWSER=chrome npm run poc:tiktok-video
```

Safariの場合:

```bash
TIKTOK_POC_COOKIES_FROM_BROWSER=safari npm run poc:tiktok-video
```

これは自分のローカルブラウザのCookieをPoCプロセス内で利用するだけで、リポジトリには保存しません。

## 成功条件

スクリプトが次をすべて満たして `PoC SUCCESS` を表示すれば、少なくともその環境・URLでは技術的な取得可否は成功と判断します。

1. すべての対象URLについて、上限回数以内にメタデータを取得できる
2. すべての対象URLについてMP4フォーマットが見つかる
3. メタデータ抽出と同じyt-dlp呼び出しでMP4をダウンロードできる
4. すべてのMP4ファイルが0 byteではない
5. `ffprobe`が導入済みなら、映像・音声ストリームを解析できる

1件でも上限回数以内に取得できなければPoC失敗です。リトライによる成功は、単発成功率100%を意味しません。結果にはURLごとの成功試行回数と全試行数が表示されます。

## 2026-08-31 再検証結果

Cookieなし、同じローカルIP、既定3 URLで実MP4ダウンロードまで確認しました。

| yt-dlp                      | 最大試行回数 | 実行結果                        | 全試行数 |
| --------------------------- | -----------: | ------------------------------- | -------: |
| `2026.08.19`                |            5 | 3/3 URL成功                     |        4 |
| `2026.08.19`                |            5 | 3/3 URL成功                     |        8 |
| `2026.08.19`                |            5 | 2/3 URL成功、1 URLは5回連続失敗 |        7 |
| `2026.08.19`                |            5 | 3/3 URL成功                     |        6 |
| nightly `2026.08.30.232658` |            5 | 3/3 URL成功                     |       10 |
| `2026.08.19`                |           10 | 3/3 URL成功                     |       15 |

成功したMP4はすべて0 byteより大きく、`file`コマンドでISO Base Media MP4と確認しました。最終実行では各URLが3回目、7回目、5回目に成功しています。

stableとnightlyのどちらでも、失敗時は`Unable to extract universal data for rehydration`でした。nightlyへの変更だけでは改善しませんでした。`app_info`を有効にしたモバイルAPI経路も空応答となり、Web抽出へフォールバックしました。

最大5回の実行は15 URL試行中14 URL成功（nightlyを含む）、stable版だけでは12 URL試行中11 URL成功でした。この結果を根拠に本番初期値は「初回を含めて最大5回」とします。5回すべて失敗した場合は非リトライ可能な取得失敗とし、Cloud Tasksによって同じ5回を繰り返しません。

このPoCが確認したのは、二重抽出を避け、時間を空けて処理全体を再試行すると成功率が改善したことです。任意の公開URLに対する成功保証、別IP・Cloud Runでの成功、ログイン・年齢・地域制限投稿の取得は確認していません。

## 一時ファイルと診断ログ

デフォルトではダウンロードした動画・yt-dlpバイナリ・メタデータJSON・verboseログを終了時にすべて削除します。

検証結果やエラーログを残したい場合:

```bash
KEEP_TIKTOK_POC_VIDEO=1 npm run poc:tiktok-video
```

終了時に保存先の一時ディレクトリが表示されます。動画をGit管理対象へ追加しないでください。

## 任意のyt-dlpを使う

自分で用意したyt-dlpを使いたい場合は `YT_DLP_BIN` を指定できます。

```bash
YT_DLP_BIN="$(command -v yt-dlp)" npm run poc:tiktok-video
```
