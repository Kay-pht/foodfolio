# Foodfolio App Store screenshots

App Store掲載用のプロモーション画像を、既存のiPhoneスクリーンショットを素材としてHTML/CSSで組み立てます。

## 方針

- `assets/` の元スクリーンショット自体は編集しない
- 見せ方はHTML/CSS側で作る
- スクリーンショット上の丸囲み・吹き出し・矢印・タップ位置もHTML/CSSのオーバーレイ
- コピー、背景、余白、影、傾き、端末フレームもコードで変更可能
- 生成物は `output/` に出し、Git管理しない
- 出力サイズはiPhone 6.9インチ用の `1320 x 2868` px

## セットアップ

```bash
cd marketing/app-store
npm install
npx playwright install chromium
```

## 生成

リポジトリルートから:

```bash
npm run appstore:generate
```

またはこのディレクトリから:

```bash
npm run generate
```

`output/` に6枚のPNGが生成されます。

## 編集箇所

- `src/slides.js`
  - コピー
  - 使用する元スクショ
  - 操作ステップ
  - スクショ上の注釈位置
- `src/styles.css`
  - 配色
  - タイポグラフィ
  - 端末サイズ・傾き
  - 吹き出し、丸囲み、背景装飾
- `scripts/export.mjs`
  - 出力処理

## 現在の6枚

1. Web / SNS / AI Chat のレシピを一か所にまとめる
2. URLを貼るだけで追加
3. 共有メニューからFoodfolioへ追加
4. 「作りたい」で候補を整理
5. 材料・作り方を料理中に見やすく確認
6. 保存数を気にせず好きなだけ一か所に集約

元スクショそのものは壊さず、操作説明だけをコード上で重ねるため、素材差し替え時も同じデザインを再利用できます。
