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

2026-09-07時点のyt-dlp stable `2026.08.19`をPoCとFoodfolioのDocker runtimeで使用しています。現行Instagram extractorは動画URLを`formats`、画像候補を`thumbnails`へ格納します。一方、yt-dlpは動画・音声ダウンローダーであり、画像投稿は通常`No video formats`になります。

yt-dlp maintainerは画像について、`--write-thumb --ignore-no-formats-error`で取得する方法を案内しています。このPoCではproduction側で扱いやすい形を確認するため、`--ignore-no-formats-error`でメタデータJSONを取得し、各entryの最大画像候補URLを直接HTTPダウンロードします。

参照:

- yt-dlp Instagram extractor: https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py
- `--ignore-no-formats-error`: https://github.com/yt-dlp/yt-dlp/blob/master/README.md
- single photo issue: https://github.com/yt-dlp/yt-dlp/issues/16328
- image-only carousel issue: https://github.com/yt-dlp/yt-dlp/issues/17077
- mixed carousel issue: https://github.com/yt-dlp/yt-dlp/issues/7569

画像URLを安定して取得できない場合は、yt-dlp metadataをInstagram画像対応の基盤には採用せず、gallery-dlやInstagram Web側の取得方式を比較します。

## ケースのモード

各caseには`mode`があります。

- `assert`: 投稿種別が現在も確認済みで、production採用判断に使うケース。期待値不一致や取得失敗は`FAIL`
- `probe`: 歴史的サンプル、削除済みの可能性があるURL、現在の投稿種別が確定していないURL。結果は`INCONCLUSIVE`であり、production採用判断には使わない

`mode`省略時は`assert`です。

サンプルURL自体の陳腐化を方式の失敗として数えないため、既定caseのうち現在有効な根拠がない`single-image`と`mixed-carousel`は`probe`にしています。

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

既定の`cases.json`はyt-dlp本体のテストやissueで公開されている回帰確認用URLです。第三者投稿は削除・非公開化される可能性があるため、最終判断ではFoodfolioで実際に扱いたい、ブラウザから匿名閲覧できる公開レシピ投稿へ差し替えてください。

ローカル用case fileは、Git管理外の`poc/artifacts/`配下へ置くことを推奨します。

```json
[
  {
    "id": "reel",
    "expectedKind": "reel",
    "mode": "assert",
    "url": "https://www.instagram.com/reel/.../"
  },
  {
    "id": "video-post",
    "expectedKind": "video",
    "mode": "assert",
    "url": "https://www.instagram.com/p/.../"
  },
  {
    "id": "single-image",
    "expectedKind": "image",
    "mode": "assert",
    "url": "https://www.instagram.com/p/.../"
  },
  {
    "id": "image-carousel",
    "expectedKind": "image-carousel",
    "mode": "assert",
    "url": "https://www.instagram.com/p/.../"
  },
  {
    "id": "mixed-carousel",
    "expectedKind": "mixed-carousel",
    "mode": "assert",
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

`assert`ケースでは以下をすべて満たした場合のみ`PASS`です。

1. yt-dlpがJSONメタデータを取得できる
2. 投稿種別が期待値と一致する
3. カルーセルは全entryが欠落せず、元の順番で列挙される
4. 各entryから画像または動画のURLを取得できる
5. 各メディアURLを匿名アクセスで実ダウンロードできる
6. 各ファイルが0 byteではなく、100MB以下である

production採用判断には、`reel`、`video`、`image`、`image-carousel`、`mixed-carousel`の5種類すべてについて、少なくとも1件の`assert`ケースが`PASS`する必要があります。

終了状態は以下です。

- `PoC SUCCESS`: 必須5種類すべてのassertケースがPASS
- `PoC FAILED`: 有効なassertケースがFAIL
- `PoC INCONCLUSIVE`: assertのFAILはないが、probeしかない種類が残る。終了コードは2

## リトライ

Instagram側の一時的な失敗を単発の方式不成立と誤判定しないよう、ケースごとに初回を含めて最大3回試行します。

変更する場合:

```bash
INSTAGRAM_POC_MAX_ATTEMPTS=5 npm run poc:instagram-media:docker
```

`assert`ケースは期待条件を満たすまで再試行します。`probe`ケースはメディア取得まで成功すれば観測値を残してそこで終了します。メタデータ取得自体に失敗する場合は上限まで再試行します。

## 認証・Cookie

このPoCはCookie、Instagramログイン、private投稿、年齢・地域制限の回避を扱いません。

FoodfolioのMVPで必要なのは、ユーザーが共有した公開投稿をbackendが匿名で処理できることなので、Cookieなしで成功することを採用条件にします。ブラウザCookieやsession IDをリポジトリへ保存しないでください。

## 結果の読み方

`result.md`にはケースごとのmode、期待種別、実際に検出した種別、entry数、実ダウンロード成功数、診断ログ末尾、production採用判断に不足している投稿種別が出ます。

典型的な判断は以下です。

- Reel/動画はPASS、画像の有効assertケースがFAIL: Instagram画像は別取得方式を比較する
- 画像カルーセルPASS、mixed carouselの有効assertケースだけFAIL: 混在投稿だけ別方式または追加処理を検討する
- probeがINCONCLUSIVE: 方式不成立とは判断せず、現在有効な公開レシピURLへ差し替える
- 必須5種類すべてassert PASS: yt-dlp metadata + media URL取得を共通Instagram media fallbackの第一候補にできる
- DockerだけFAIL、ローカルPASS: IP、fingerprint、ネットワーク環境差の追加検証が必要

## 2026-09-07 Docker実行結果

`node:24.18.0-slim`、yt-dlp `2026.08.19`、Cookieなし、ケースごとに最大3回の条件で実行しました。

旧PoC表示では3/5 PASS・2 FAILでしたが、2件はproduction方式のFAILを示すサンプルではありません。判定境界を修正すると、証拠としては以下です。

| Case           | Mode   | Expected       | Actual         | Assets | Downloads | Attempts | Outcome      |
| -------------- | ------ | -------------- | -------------- | -----: | --------: | -------: | ------------ |
| reel           | assert | reel           | reel           |      1 |       1/1 |        1 | PASS         |
| video-post     | assert | video          | video          |      1 |       1/1 |        1 | PASS         |
| single-image   | probe  | image          | image-carousel |      3 |       3/3 |        3 | INCONCLUSIVE |
| image-carousel | assert | image-carousel | image-carousel |      5 |       5/5 |        1 | PASS         |
| mixed-carousel | probe  | mixed-carousel | unknown        |      0 |       0/0 |        3 | INCONCLUSIVE |

### single-image

Issue #16328はURLを「public photo post」と説明していますが、Issue自体は`invalid`としてcloseされ、yt-dlp maintainersは画像ダウンロードを通常のyt-dlp対象外と説明しています。今回のPoCでは同URLから異なる3画像が列挙され、3件とも実ダウンロードできました。

したがって、この結果は「単一画像取得の失敗」でも「単一画像取得の成功」でもありません。このURLを単一画像assertケースとして使うことができない、という結果です。

### mixed-carousel

Issue #7569では当時10メディアの画像・動画混在投稿として提示されていましたが、2026-09-07の実行ではInstagramからmedia metadataを取得できず、ブラウザでも投稿を利用できませんでした。

したがって、このURLも現在のmixed carousel方式を判定するassertケースには使えません。

### 現時点の判断

確認できたのは以下です。

- Reel: 匿名Docker環境で動画取得成功
- 通常動画: 匿名Docker環境で動画取得成功
- 画像カルーセル: 5画像を順序付きで列挙し、5/5実ダウンロード成功

未確認なのは以下です。

- 現在有効な単一画像レシピ投稿
- 現在有効な画像 + 動画の混在カルーセル投稿

この2種類を`mode: "assert"`の有効な公開レシピURLへ差し替えて再実行するまで、Instagram共通fallbackのproduction採用判断は`INCONCLUSIVE`です。
