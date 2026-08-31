# TikTok video download PoC

## 目的

Foodfolioでユーザーが保存した公開TikTok URLから、動画ファイルを技術的に取得できるかをローカル環境で確認するPoCです。

これは本番採用を決定する実装ではありません。TikTok公式APIでは任意の第三者投稿のMP4ダウンロードURLは提供されていないため、このPoCでは非公式のWeb抽出方式であるyt-dlpを利用します。本番採用時は利用規約・安定性・運用リスクを別途判断します。

## 実行

リポジトリルートで次を実行します。

```bash
npm run poc:tiktok-video
```

既定では3件のTikTokレシピURLを順番に検証します。1件が失敗しても残りのURLを継続して試し、成功したURLが1件でもあれば、そのうち1件をMP4として一時ダウンロードします。

各URLでは次の順でメタデータ取得を試します。

1. yt-dlpの通常TikTok抽出
2. 失敗した場合、明示的なChrome request impersonation
3. それでも全URLが失敗した場合、必要に応じてブラウザCookie付きで再実行

特定URLだけを試す場合:

```bash
npm run poc:tiktok-video -- 'https://www.tiktok.com/@USER/video/VIDEO_ID'
```

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

これはMP4ダウンロード以前に、yt-dlpがTikTokのWebページから動画情報を取得できなかった状態です。PoCはそのURLだけを失敗扱いにして残りのURLを継続します。また、通常抽出が失敗したURLではChrome request impersonationを自動で再試行します。

全URLが同じエラーで失敗する場合は、TikTok側が匿名Webアクセスに返している内容がyt-dlpで解析できない可能性があります。その場合は次のブラウザCookie付き検証へ進みます。

## TikTokがログインを要求する場合 / 匿名アクセスが全滅する場合

公開投稿でもTikTok側のアクセス判定によってブラウザCookieが必要になる場合があります。その場合は、自分のブラウザに保存されているTikTokセッションをyt-dlpへ渡して再検証できます。

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

1. 1件以上のTikTok URLからメタデータを取得できる
2. 少なくとも1つのMP4フォーマットが取得候補として見つかる
3. 実際にMP4ファイルをダウンロードできる
4. ダウンロードしたファイルが0 byteではない
5. `ffprobe` が導入済みなら、映像・音声ストリームを解析できる

複数URLの一部だけ成功した場合もPoCは成功として扱いますが、失敗件数を最後に表示します。これは本番採用時の安定性評価では別途考慮します。

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
