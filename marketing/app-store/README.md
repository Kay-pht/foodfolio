# Foodfolio App Store screenshots

App Store掲載用のプロモーション画像を、既存のiPhoneスクリーンショットを壊さずHTML/CSSで組み立てます。

## 方針

- `assets/` の元スクリーンショットは編集しない
- スクリーンショット内部への文字入れ、フィルター、トリミングはしない
- コピー、背景、余白、影、配置などの周辺デザインだけをHTML/CSSで作る
- 生成物は `output/` に出し、Git管理しない
- 出力サイズはiPhone 6.9インチ用の `1320 x 2868` px
- コピーや素材の割り当ては `src/slides.js`、見た目は `src/styles.css` で変更する

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

## 現在の構成

1. レシピを一か所にまとめる
2. URLだけで追加
3. シェア拡張から追加
4. 「作りたい」で整理
5. 材料・作り方を見やすく確認
6. 保存数を気にせず一か所に集約

1枚目には、Web・SNSに加えてAIチャット由来のレシピも扱えることを明示しています。
