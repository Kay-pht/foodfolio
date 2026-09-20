# Jev media routing PoC 検証結果

## 1. 判定

2026-09-20、`jev-1.13.0`を使い、YouTube、Instagram、TikTok、ChatGPT公開共有、Gemini公開共有を対象とするmedia routing PoCをローカル環境で検証した。評価はcontrolled fixtureと、productionと同じsource-content extractorを使う実公開URLの2段階で行った。Cloud Run、本番Worker、本番トラフィックでの検証結果ではない。

今回評価した`probabilities.recipe`閾値`0.80 / 0.90 / 0.95 / 0.98 / 0.99`のうち、controlled fixtureと実URLの両方でunsafe fast-routeを0件に保ったのは`0.99`だけだった。`0.90`は高速経路の安定coverageを増やさず、fallbackが必要なInstagram／TikTokケースを高速経路へ送った。

したがって、media routingで共通閾値を置く場合の暫定候補は`0.99`とする。

```text
probabilities.recipe >= 0.99
  -> YouTubeは説明欄十分性も満たす場合だけZ.ai
  -> Instagram / TikTokは取得テキスト経路

probabilities.recipe < 0.99
  -> 拒否せず、YouTubeはGemini、Instagram / TikTokはmedia解析へfallback
```

これは一般Web PoCの`probabilities.non_recipe >= 0.80`によるnon-recipe終了判定とは別の閾値・別の用途である。実URLは14/100件で、媒体・ラベル分布も偏っているため、`0.99`を本番有効化する根拠としては未完成である。

## 2. 評価対象と共通条件

| 項目             | Controlled fixture |         実URL |
| ---------------- | -----------------: | ------------: |
| 入力件数         |                 28 |            14 |
| Jev対象件数      |                 25 |            14 |
| 反復回数         |              各3回 |         各3回 |
| Jev分類回数      |                 75 |            42 |
| 正しい二択回答   |       69/75（92%） | 42/42（100%） |
| choice不安定case |                  0 |             0 |
| terminal invalid |                  0 |             0 |
| 推定費用         |       $0.001388646 |  $0.004315122 |

合計117回のJev分類に対するmedia routing PoCの推定費用は`$0.005703768`だった。正解ラベルと期待routeはJevへ送っていない。生の抽出本文と共有会話本文はresultへ保存せず、実URL corpusとresultはGit管理対象外とした。

## 3. Controlled fixture結果

controlled corpusは28 fixtureで、テキストなし3件はJevを呼ばず直接fallbackし、残る25件を各3回評価した。

分類精度は全体92%だった。YouTubeとAI共有会話は100%、InstagramとTikTokは各80%で、誤った二択回答は`instagram-recipe-title-only`と`tiktok-title-only`の2 caseに限定された。いずれも料理名だけで具体的な材料・手順がないため、分類の正しさだけで高速経路へ送らず、期待routeとの組み合わせで安全性を評価した。

### 3.1 閾値比較

| `recipe`閾値 | unsafe fast-route | 高速経路の安定coverage | fallback安全維持率 |
| -----------: | ----------------: | ---------------------: | -----------------: |
|         0.80 |              3/15 |                    80% |                80% |
|         0.90 |              3/15 |                    80% |                80% |
|         0.95 |              2/15 |                    80% |             86.67% |
|         0.98 |              1/15 |                    80% |             93.33% |
|         0.99 |              0/15 |                    80% |               100% |

`0.90`のunsafe fast-routeは次の3件だった。

- `instagram-video-reference`
- `tiktok-photo-hashtag-only`
- `tiktok-media-reference`

`0.99`ではこの3件をすべてfallbackに維持しながら、期待される高速経路の安定coverageは`0.90`と同じ80%だった。

### 3.2 媒体別の暫定候補

controlled fixtureだけから算出される候補はYouTube `0.80`、Instagram `0.99`、TikTok `0.98`だった。ただし媒体別閾値は少数fixtureへ適合した値であり、実URL100件の完了前に本番値として採用しない。共通閾値としては、すべての媒体でunsafe fast-route 0件だった`0.99`だけを暫定候補とする。

## 4. 実URL結果

実URL corpusは、公開状態と抽出本文を実際に確認した14 URLを人手でラベル付けした。productionの`ProductionSourceContentExtractor`、ChatGPT／Gemini shared-conversation adapter、YouTube description sufficiency判定を再利用した。

| Source          | 件数 |
| --------------- | ---: |
| YouTube         |    4 |
| Instagram       |    7 |
| TikTok          |    1 |
| ChatGPT公開共有 |    1 |
| Gemini公開共有  |    1 |
| 合計            |   14 |

`expectedKind`はrecipe 12件、non-recipe 2件だった。14件すべてで抽出と3反復が完了し、二択回答は42/42回正解、choice不安定caseは0件だった。

### 4.1 閾値比較

| `recipe`閾値 | unsafe fast-route | 高速経路の安定coverage | fallback安全維持率 |
| -----------: | ----------------: | ---------------------: | -----------------: |
|         0.80 |               3/4 |                  87.5% |                25% |
|         0.90 |               2/4 |                  87.5% |                50% |
|         0.95 |               1/4 |                  87.5% |                75% |
|         0.98 |               1/4 |                  87.5% |                75% |
|         0.99 |               0/4 |                  87.5% |               100% |

`0.90`では次の2件を誤って高速経路へ送った。

- `tiktok-001`: 1つの餅レシピだが、取得できる本文は短い料理名だけで材料・手順が不足
- `instagram-005`: 1つの餅ホットケーキレシピだが、captionは詳細をアプリへ誘導するだけで材料・手順が不足

`0.99`では両方をfallbackへ維持した。期待される高速経路8件のうち7件は3回とも高速条件を満たし、安定coverageは87.5%だった。

### 4.2 境界ケース

`youtube-002`は1動画・1説明欄に5つのおせちレシピを含むため、正解ラベルを「1つの具体的レシピではない」non-recipeとした。既存の構造判定は材料と手順があるため十分と判定したが、Jevは3回とも`non_recipe`、`probabilities.non_recipe=0.97 / 0.98 / 0.97`だった。説明欄の構造だけでは区別できない複数レシピ動画をsemantic gateがfallback側へ維持した例である。

ChatGPT共有のrecipe probabilityは3回とも`0.77〜0.79`で、Gemini共有は3回とも`1.00`だった。この2件だけではAI共有会話に共通の`0.99`を適用する妥当性を示せない。AI共有会話の閾値判断と、YouTube／Instagram／TikTokのmedia routing判断を分けて扱う。

## 5. `0.90`を採用しない理由

`0.99`未満はレシピ拒否ではなく、高価だが情報量の多い経路へのfallbackである。したがって`0.99`による主な不利益はfallback増加であり、レシピの取り込み拒否ではない。

今回のcontrolled fixtureと実URLでは、`0.90`へ下げても高速経路の安定coverageは増えなかった。一方で、controlled fixture 3件、実URL2件がunsafe fast-routeになった。確認できた範囲では`0.90`に費用面・coverage面の利益がなく、安全性だけが低下した。

## 6. 制約と残作業

実URL評価は次の理由で未完成である。

- 目標100 URLに対して14 URLで、`validationReady=false`
- TikTokは1件のみ
- 実URLnon-recipeは2件のみ
- ChatGPT／Gemini共有は各1件で、AI共有non-recipeは0件
- Instagramが14件中7件を占め、媒体分布が偏っている
- 公開投稿の削除、非公開化、本文変更、provider形式変更で再現結果が変わり得る
- ローカル実行であり、Cloud Run、本番Worker、実アプリ経路の証拠ではない

追加検証ではTikTok、各媒体のnon-recipe、media-required、AI共有non-recipeを優先する。100 URLに到達し、terminal invalid 0件と全caseの3反復完了を確認するまで`productionQualified=false`を維持する。

## 7. 証拠と再現方法

- Controlled result: `poc/results/jev-media-routing-results.json`（Git管理対象外）
- 実URL corpus: `poc/inputs/jev-media-live-corpus.json`（Git管理対象外）
- 実URL result: `poc/results/jev-media-live-results.json`（Git管理対象外）
- 実行方法・評価ルール: [Jev recipe gate PoC](../poc/jev-recipe-gate/README.md)
- Media routing仕様: [Jev media routing](../poc/jev-recipe-gate/media-routing.md)
- 一般Web結果: [Jev 一般Webレシピゲート PoC 検証結果](poc-jev-recipe-gate-results.md)
- Specification as Code: [JEV-RECIPE-GATE-POC-001](../specs/tasks/JEV-RECIPE-GATE-POC-001.yaml)

実行コマンドは次のとおり。

```bash
npm run poc:jev-media
npm run poc:jev-media-live
```

`npm run poc:jev-media-live`はリポジトリ直下の`.env`を読み、`.env.local`が存在する場合は同名値を上書きする。`TYPESAFE_API_KEY`と、YouTube URLを含む場合の`YOUTUBE_API_KEY`はresultへ保存しない。

この文書は実測結果の要約であり、本番ルーティングを有効化するものではない。
