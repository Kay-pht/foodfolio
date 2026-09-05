# Gemini YouTube動画入力 PoC（2026-09-05）

## 判定

**無料枠でYouTube URLを動画入力に渡し、既存レシピSchemaに適合するJSONを取得できた。抽出品質は本番採用に合格とは判定しない。**

既存料理動画3本を各1回実行し、3/3がHTTP 200・finishReason STOP・Schema適合・材料と手順が空でないことを満たした。動画入力トークンも3/3で記録された。ただし、これは全項目の正確性や映像・音声それぞれの理解精度の証明ではない。

## 実行条件と証跡

- ブランチ: `codex/gemini-youtube-poc`
- モデル: `gemini-3.5-flash-lite`。実際のModels APIの一覧と応答のmodelVersionで確認。
- API: Gemini Developer API `v1beta/models/gemini-3.5-flash-lite:generateContent`
- 入力: `fileData.fileUri` にYouTube URL、`mimeType: video/mp4`。動画本体・字幕のダウンロードやURL Contextは使用しない。
- 出力: `schemas/extracted-recipe.schema.json` を `responseJsonSchema` に指定。Ajvで再検証。
- 既存Schemaは1品単位なので、複数料理動画は最初の1品を対象とした。タグは既存Schemaにないため未検証。
- APIキーはローカルの `GEMINI_API_KEY`。API Keys lookupで所属先を確認し、Cloud Billing APIで `projectId: continue-log`, `billingEnabled: false` を確認。各生成直前にも再確認した。プロジェクト・課金・IAM設定は変更していない。
- 課金有効・不明の場合は生成前に停止。HTTPエラー時は残りの動画を実行せず、自動再試行・別モデルへの切り替えもしない。
- 結果: [機械可読レポート](../poc/results/gemini-youtube-2026-09-05T02-03-05.561Z.json)
- 生応答: `poc/artifacts/gemini-youtube/2026-09-05T02-03-05.561Z/`（Git対象外）

実行コマンド（無料状態を再確認してから最大3回の生成を行う）:

```sh
npx tsx poc/ai-extraction/run-gemini-youtube.ts
```

## 実API結果

| 動画 | 抽出料理 | HTTP / Schema | 時間 | 入力token（うち動画） | 出力token |
| --- | --- | --- | --- | --- | --- |
| [0to72EbNg8A](https://www.youtube.com/watch?v=0to72EbNg8A) | とろとろ豚バラ白菜 | 200 / 適合 | 12.164秒 | 35,720（35,593） | 589 |
| [iKAx33FFOjg](https://www.youtube.com/watch?v=iKAx33FFOjg) | クリームチーズ伊達巻 | 200 / 適合 | 13.349秒 | 71,287（71,160） | 346 |
| [SRwvUL-s-eo](https://www.youtube.com/watch?v=SRwvUL-s-eo) | 元気ママ流の最高ハンバーグ | 200 / 適合 | 11.437秒 | 40,987（40,860） | 624 |

生成応答時間合計36.950秒、平均12.317秒。課金状態確認や画面照合の時間を含まない。入力147,994token、出力1,559token。無料枠で実行し、429や課金要求は発生していない。請求明細の監査は実施していない。

## 品質の確認範囲と問題

### 伊達巻: 動画の誤記をそのまま抽出し、材料も欠落

2026-09-05にブラウザで原動画・公開説明欄・投稿者の固定コメントを確認した。

- [0:20付近](https://www.youtube.com/watch?v=iKAx33FFOjg&t=20s): テロップは卵1個、容器の映像には卵黄が2個見える。
- 公開説明欄は卵2個。投稿者の固定コメントでも、動画内の1個表記が誤りで正しくは2個と訂正している。
- Geminiの出力は卵1個。テロップとは一致するため、根拠のない創作と断定はできない。一方、映像・訂正済み説明欄と矛盾するレシピが返ることを確認した。
- 説明欄にあり、Gemini自身の手順にも登場するクリームチーズが材料一覧にない。材料の網羅性には明確な問題がある。
- 調理時間15分の出力は根拠時刻を取得しておらず、正確性未確認。

この事例は「説明欄を捨てて動画だけに置き換えれば品質が上がる」とは言えない根拠になる。動画の文字・映像・説明欄が矛盾した場合の扱いを別途設計する必要がある。

### 豚バラ白菜: 既存fixtureとの差分

`poc/ai-extraction/results/expected.json` の既存正解データと比較した（動画全編との再照合ではない）。

- 白菜、生姜、豚バラ肉、料理酒、砂糖、醤油、鶏ガラ、ごま油の主要分量は表記差を除き一致。
- 塩・こしょうのamountは「下ごしらえ用」。fixtureの「適量」と異なり、量の欄に用途が入っている。
- 片栗粉と水は材料2件に分かれず、材料名「水溶き片栗粉(片栗粉大さじ1、水大さじ2)」に内包。分量情報は残るがアプリでの材料表示・検索には検討が必要。
- 調理時間はfixtureの20分に対してnull。動画内に20分の根拠があるか未照合なので、誤抽出とは断定しない。

### ハンバーグ: 全項目の照合は未実施

玉ねぎの分量は「適量」、servingsはvalue 8 / raw「8個」。後者は人数ではなく個数なので、UI側で人数に変換していないかは本番統合時に確認が必要。全編・全分量・全手順の正確性は未判定。

## チェックリスト

- [x] 公式ドキュメントで公開YouTube URL入力の対応を確認
- [x] 既存YouTube取得処理と既存レシピSchemaを確認
- [x] 設定済みキーの所属先・課金無効を実APIで確認
- [x] 無料枠のみ・課金不明時停止・エラー時停止のPoCを用意
- [x] 既存料理動画3本で実API実行（3/3成功）
- [x] 既存Schemaに適合する非空のレシピJSONを取得（3/3）
- [x] 動画入力token、応答時間、モデル名を保存
- [x] 伊達巻の画面表示・説明欄・投稿者訂正との限定的な目視照合
- [x] 材料欠落、動画内の矛盾が抽出結果に残る事例を確認
- [x] 変更部分のテスト7件成功
- [x] 全体テスト成功（unit 81件、integration 25件、E2E 14件）
- [x] lint、format check、build、Prisma generate / validate成功（`npm run verify` exit 0）
- [ ] 全3本の全材料・分量・手順・調理時間の正確性合格
- [ ] 映像のみ・音声のみの寄与を分離した検証
- [ ] 同一動画の反復実行による安定性確認
- [ ] 非公開・限定公開・削除済み・非料理動画の実API検証
- [ ] 本番フローへの統合、CI、デプロイ、iOS実機確認（今回のPoC対象外）

PoCの接続・構造化出力の検証は完了。品質合格と本番採用判断は未完了。既存 `tasks/todo.md` に対応するPoC項目がないため、無関係な項目は変更せず、本書でチェックリストを管理する。

## 次に検討する案

YouTube Data APIで取得している説明欄とGemini動画入力を併用し、材料の欠落と入力間の矛盾を検出する案が考えられる。ただし、この併用案の精度は今回未検証。投稿者コメントの自動取得も実装していない。動画由来の各値に根拠時刻を残し、矛盾する場合に無言でどちらかを採用しない仕組みを、次の品質PoCで検証する。

## 公式情報

- [Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding#pass-youtube-urls): 公開YouTube動画に対応。Previewで、無料枠は1日8時間まで。非公開・限定公開は対象外。URL対応機能の料金・制限は変更され得る。
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite): 対象モデルのStandard入力・出力にFree Tierあり。YouTube URL機能の「追加料金なし」と、有料Tierの推論料金を混同しない。
- [Billing](https://ai.google.dev/gemini-api/docs/billing): 無料・有料Tierと課金設定の説明。

以上は2026-09-05の取得情報。料金や制限は再実行時に再確認する。
