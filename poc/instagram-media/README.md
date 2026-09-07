# Instagram Media PoC

## 目的

Foodfolioが公開Instagram投稿から、AI解析に必要なメディア本体を匿名アクセスで取得できるかを、production実装とは分離して検証するPoCです。

対象は以下の5ケースです。

1. Reel
2. 通常の単一動画投稿
3. 単一画像投稿
4. 画像カルーセル
5. 画像 + 動画の混在カルーセル

このPoCはレシピ抽出精度を評価しません。確認するのは、投稿内メディアを順序付きで列挙し、各画像・動画を実ファイルとして取得できるかです。

## 方針

現行productionではTikTok動画取得にyt-dlpを利用しているため、Instagramでも最初に同じ依存を再利用できるかを検証します。

2026-09-07時点のyt-dlp最新stableは`2026.08.19`です。現行Instagram extractorは動画URLを`formats`、画像候補を`thumbnails`へ格納します。一方、yt-dlpは通常、動画formatがない投稿では`No video formats`として終了します。

そこでPoCでは公式オプション`--ignore-no-formats-error`を使い、画像投稿でもメタデータJSONを残せるかを確認します。メタデータに画像候補が残る場合は、そのURLを即時ダウンロードして実データ取得まで検証します。

参照:

- yt-dlp Instagram extractor: https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py
- `--ignore-no-formats-error`: https://github.com/yt-dlp/yt-dlp/blob/master/README.md
- image-only carousel issue: https://github.com/yt-dlp/yt-dlp/issues/17077
- mixed carousel issue: https://github.com/yt-dlp/yt-dlp/issues/7569

この方式で画像を取得できなければ、yt-dlp単独ではInstagram画像対応の基盤にできない、というPoC結果として扱います。その場合にのみ次の候補（Instagram Web APIの直接利用等）を別途比較します。

## 推奨実行方法: Docker

Cloud Runとの差を減らすため、まずDockerで実行してください。

```bash
npm run poc:instagram-media:docker
```

PoC用Docker imageは、Foodfolioのruntimeと同じ`node:24.18.0-slim`とyt-dlp `2026.08.19`を使います。

結果はGit管理外の以下へ出力されます。

```text
poc/artifacts/instagram-media/<timestamp>-docker/
  result.json
  result.md
  reel/
  video-post/
  single-image/
  image-carousel/
  mixed-carousel/
```

各ケース配下には、取得できたメディアファイルと`yt-dlp.json`が保存されます。

## ローカル実行

ローカルにyt-dlpがある場合は直接実行できます。

```bash
npm run poc:instagram-media
```

任意のバイナリを使う場合:

```bash
YT_DLP_BIN=/path/to/yt-dlp npm run poc:instagram-media
```

## 実レシピURLへ差し替える

既定の`cases.json`はyt-dlp本体のテストやissueで公開されている回帰確認用URLです。第三者投稿は削除・非公開化される可能性があるため、最終判断ではFoodfolioで実際に扱いたい公開レシピ投稿へ差し替えてください。

ローカル用case fileは、Git管理外の`poc/artifacts/`配下へ置くことを推奨します。

```json
[
  {
    "id": "reel",
    "expectedKind": "reel",
    "url": "https://www.instagram.com/reel/.../"
  },
  {
    "id": "video-post",
    "expectedKind": "video",
    "url": "https://www.instagram.com/p/.../"
  },
  {
    "id": "single-image",
    "expectedKind": "image",
    "url": "https://www.instagram.com/p/.../"
  },
  {
    "id": "image-carousel",
    "expectedKind": "image-carousel",
    "url": "https://www.instagram.com/p/.../"
  },
  {
    "id": "mixed-carousel",
    "expectedKind": "mixed-carousel",
    "url": "https://www.instagram.com/p/.../"
  }
]
```

Docker:

```bash
npm run poc:instagram-media:docker -- \
  --cases poc/artifacts/instagram-media/cases.local.json
```

ローカル:

```bash
npm run poc:instagram-media -- \
  --cases poc/artifacts/instagram-media/cases.local.json
```

## 成功条件

各ケースで以下をすべて満たした場合のみPASSです。

1. yt-dlpがJSONメタデータを取得できる
2. 投稿種別が期待値と一致する
3. カルーセルは全entryが欠落せず、元の順番で列挙される
4. 各entryから画像または動画のURLを取得できる
5. 各メディアURLを匿名アクセスで実ダウンロードできる
6. 各ファイルが0 byteではなく、100MB以下である

5ケースすべてPASSした場合だけ全体を`PoC SUCCESS`とします。

## リトライ

Instagram側の一時的な失敗を単発の方式不成立と誤判定しないよう、ケースごとに初回を含めて最大3回試行します。

変更する場合:

```bash
INSTAGRAM_POC_MAX_ATTEMPTS=5 npm run poc:instagram-media:docker
```

各試行は新しいyt-dlpプロセスです。上限まで失敗したケースはFAILになります。

## 認証・Cookie

このPoCはCookie、Instagramログイン、private投稿、年齢・地域制限の回避を扱いません。

FoodfolioのMVPで必要なのは、ユーザーが共有した公開投稿をbackendが匿名で処理できることなので、Cookieなしで成功することを採用条件にします。ブラウザCookieやsession IDをリポジトリへ保存しないでください。

## 結果の読み方

`result.md`にはケースごとの期待種別、実際に検出した種別、entry数、実ダウンロード成功数、診断ログ末尾が出ます。

典型的な判断は以下です。

- Reel/動画だけPASS、画像系FAIL: 既存TikTok型の動画fallbackは流用可能だが、Instagram画像は別取得方式が必要
- 画像もPASS、mixed carouselだけFAIL: 単一画像/画像カルーセルと混在カルーセルを実装上分離する必要がある
- 5ケースPASS: yt-dlp metadata + media URL取得を共通Instagram media fallbackの第一候補にできる
- DockerだけFAIL、ローカルPASS: IP、fingerprint、ネットワーク環境差の追加検証が必要

公開回帰URL自体が削除・非公開化されている場合、そのケースの失敗だけで方式不成立とは判断しません。ブラウザから匿名で開ける実レシピURLへ差し替えて再実行してください。

## 2026-09-07 Docker実行結果

`node:24.18.0-slim`、yt-dlp `2026.08.19`、Cookieなし、ケースごとに最大3回の条件で実行し、3/5ケースがPASSしました。

| Case           | Expected       | Actual         | Assets | Downloads | Attempts | Result |
| -------------- | -------------- | -------------- | -----: | --------: | -------: | ------ |
| reel           | reel           | reel           |      1 |       1/1 |        1 | PASS   |
| video-post     | video          | video          |      1 |       1/1 |        1 | PASS   |
| single-image   | image          | image-carousel |      3 |       3/3 |        3 | FAIL   |
| image-carousel | image-carousel | image-carousel |      5 |       5/5 |        1 | PASS   |
| mixed-carousel | mixed-carousel | unknown        |      0 |       0/0 |        3 | FAIL   |

`single-image`はyt-dlpが異なる3画像を返し、すべての実ダウンロードにも成功したため、現在のyt-dlp出力は単一画像の期待値と一致しません。`mixed-carousel`はInstagramが空のmedia responseを返し、ブラウザ表示でも投稿ページが利用不可だったため、現在は回帰サンプルとして利用できません。

この実行結果だけでは、単一画像とmixed carouselについて方式の可否を判定できません。匿名で閲覧できる現存の実レシピURLへ2ケースを差し替え、同じDocker環境で再実行する必要があります。一方、今回のサンプルではReel、通常動画、画像カルーセルの順序付き列挙と実ファイル取得を確認できました。
