# Jev 一般Webレシピゲート PoC 検証結果

## 1. 判定

2026-09-20、ローカル環境で一般WebのHTML抽出テキストを対象に、`jev-1.13.0`によるrecipe／non-recipe判定を評価した。Cloud Runや本番Workerでの確認結果ではない。

105 URLを各3回、合計315回評価した範囲では、Jevの二択回答は訂正後の正解ラベルと315/315回一致した。`probabilities.non_recipe >= 0.80`を拒否条件とした場合、recipeの誤拒否は0/52件、non-recipeの3回一貫した拒否は52/53件（98.11%）だった。

この結果から、一般Webでは次のルーティングが有望と判断する。

```text
probabilities.non_recipe >= 0.80
  -> 非レシピとして終了

probabilities.non_recipe < 0.80
  -> 既存のレシピ抽出モデルへフォールバック
```

ただし、評価数、コーパス完成条件、入力ソースの範囲が不足しているため、`0.80`は暫定候補であり、本番hard rejectの確定値ではない。

## 2. 評価条件

| 項目         |           値 |
| ------------ | -----------: |
| モデル       | `jev-1.13.0` |
| 評価済みURL  |          105 |
| recipe       |           52 |
| non-recipe   |           53 |
| 反復回数     |    各URL 3回 |
| Jev分類回数  |          315 |
| HTTP失敗     |            0 |
| 累計推定費用 | $0.021662424 |

Jevには正解ラベルを送信せず、HTMLから抽出した本文だけを入力した。recipeでは3回のうち1回でも閾値以上になったケースを誤拒否リスクとし、non-recipeでは3回すべてが閾値以上になったケースだけを一貫して拒否可能と数えた。

## 3. 閾値別結果

| `non_recipe`閾値 | recipe誤拒否 | non-recipe一貫拒否 | 一貫拒否率 |
| ---------------: | -----------: | -----------------: | ---------: |
|             0.80 |         0/52 |              52/53 |     98.11% |
|             0.90 |         0/52 |              52/53 |     98.11% |
|             0.95 |         0/52 |              52/53 |     98.11% |
|             0.98 |         0/52 |              50/53 |     94.34% |
|             0.99 |         0/52 |              47/53 |     88.68% |

評価した閾値のうち、recipe誤拒否0件を維持しながら最も多くのnon-recipeを拒否できる最低閾値は`0.80`だった。

## 4. 境界ケース

### 味の素の商品別レシピ一覧

`https://park.ajinomoto.co.jp/recipe/products/list/639979/`はnon-recipeであり、Jevの二択回答も3回とも`non_recipe`だった。一方、`probabilities.non_recipe`は`0.63 / 0.65 / 0.63`で、閾値`0.80`には届かなかった。

このケースは誤分類ではないが、hard rejectせず既存モデルへフォールバックする。これにより、曖昧なケースを安全側へ倒す。

### 白ごはん.comのページネーション

`https://www.sirogohan.com/recipe/page:10`は「レシピ検索 10/42ページ」の一覧ページだったが、当初のURLルールがrecipeと誤ラベル付けしていた。Jevは3回とも`non_recipe`、`probabilities.non_recipe=1.0`と判定しており、モデルではなく評価ラベル側の不具合だった。

`/recipe/page:<数字>`をhard non-recipeとして扱うよう分類ルールと回帰テストを修正し、保存済み結果の正解ラベルと集計値も再計算した。Jev APIの再実行や応答値の変更は行っていない。

## 5. コーパス状況と制約

検証済みコーパス全体はrecipe 499件、non-recipe 359件、hard negative 353件である。最終目標の500/500を満たしていないため、`qualifiedCandidateThreshold`は`null`のままである。

また、今回の結果には次の制約がある。

- 評価済みはコーパス858 URL中105 URLで、残り753 URLは未評価
- 日本語のレシピサイトと、そのサイト内の検索・一覧・記事ページが中心
- TikTok、Instagram、YouTube、ChatGPT共有、Gemini共有は評価対象外
- ローカル実行結果であり、Cloud Run、本番トラフィック、実アプリ経路の証拠ではない
- recipe 52件で誤拒否0件という結果だけでは、未知の一般Web入力に対する誤拒否率0%を保証しない

したがって、このPoCは一般Webにおけるルーティング候補の有望性を示すが、他ソースへの一般化や本番有効化を証明しない。

## 6. 証拠と関連文書

- 生データ: `poc/results/jev-recipe-gate-results.json`（Git管理対象外）
- 実行方法・評価ルール: [Jev recipe gate PoC](../poc/jev-recipe-gate/README.md)
- Specification as Code: [JEV-RECIPE-GATE-POC-001](../specs/tasks/JEV-RECIPE-GATE-POC-001.yaml)
- 実装: `poc/jev-recipe-gate/`

この文書は実測結果の要約であり、正本の要件や本番ルーティングを変更するものではない。
