# Foodfolio App Store screenshots

App Store掲載用の画像をHTML/CSSで組み立てます。

## 今回の方針

- 小さい説明文は使わない
- 1枚につき「大きな日本語1メッセージ」を基本にする
- 元スクリーンショット自体は編集しない
- 操作を示す丸囲み・吹き出しだけHTML/CSSで重ねる
- 疑似Dynamic Islandなど、実機に見えない自作パーツは追加しない
- 端末枠にはApple公式Product Bezelsを使用する
- 生成物とダウンロードしたProduct BezelsはGit管理しない
- 最終出力は1320 x 2868 px

元スクリーンショットは1206 x 2622 pxです。AppleのApp Store Connect仕様では、この解像度は6.3インチディスプレイ用の有効サイズで、iPhone 17 Proも同じ区分です。

## 初回セットアップ

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

初回の生成時だけ、Apple公式のiPhone 17 Product Bezelsを取得します。
Product Bezel取得には `@diklein/dkbezeler` を使用します。ベゼル画像そのものは同パッケージには含まれず、Appleの公開配布物から取得されます。

AppleのProduct BezelsはDMGで配布されているため、自動セットアップはmacOS前提です。

## コピー

1. 「レシピを、ひとつに。」
2. 「URLを、貼るだけ。」
3. 「シェアで、すぐ保存。」
4. 「『作りたい』が、すぐ見つかる。」
5. 「材料も手順も、見やすい。」
6. 「好きなだけ、保存できる。」

補助文も52px以上、見出しは126px以上にして、App Store上で縮小された状態でも読みやすいことを優先しています。

## 編集場所

- `src/slides.js`: コピー、スクショ、注釈位置
- `src/styles.css`: サイズ、配色、傾き、背景
- `scripts/export.mjs`: Apple公式ベゼル適用とPNG出力
