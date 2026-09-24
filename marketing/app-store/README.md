# Foodfolio App Store screenshots

App Store掲載用の画像をHTML/CSSで組み立てます。

## 今回の方針

- 小さい説明文は使わない
- 1枚につき「大きな日本語1メッセージ」を基本にする
- 元スクリーンショット自体は編集しない
- 操作を示す丸囲み・吹き出しだけHTML/CSSで重ねる
- 疑似Dynamic Islandなど、実機に見えない自作パーツは追加しない
- 端末枠にはApple公式Product BezelsのPortraitを明示指定し、縦向きで大きく見せる
- 2枚目は保存できるレシピの多さを示すため、3台を重ねて傾ける
- 4枚目は材料と作り方を見比べやすくするため、2台を逆方向へ傾けて段違いに配置する
- 背景は中央基準で全面表示する共通の石材天板画像を使い、全6枚を1枚目と同じコーラル色に統一する
- 対応元の吹き出しにはSimple IconsとFont Awesomeのブランドロゴを表示し、Webには汎用グローブを使う
- 生成物とダウンロードしたProduct BezelsはGit管理しない
- 最終出力は1320 x 2868 px

元スクリーンショットは1206 x 2622 pxです。AppleのApp Store Connect仕様では、この解像度は6.3インチディスプレイ用の有効サイズで、iPhone 18 Proも同じ区分です。

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

初回の生成時だけ、Apple公式のiPhone 18 Product Bezelsを取得し、iPhone 18 Pro Burgundyを使用します。
Product Bezel取得には `@diklein/dkbezeler` を使用します。ベゼル画像そのものは同パッケージには含まれず、Appleの公開配布物から取得されます。

AppleのProduct BezelsはDMGで配布されているため、自動セットアップはmacOS前提です。

## コピー

1. 「レシピ管理をひとつに。」
2. 「無料で全ての機能を使える」
3. 「URLを貼るだけ」
4. 「材料も手順もこれ一つ！」
5. 「シェアですぐ保存」
6. 「『作りたい』が、すぐ見つかる。」

補助文も52px以上、見出しは126px以上にして、App Store上で縮小された状態でも読みやすいことを優先しています。

## 編集場所

- `src/slides.js`: コピー、スクショ、注釈位置
- `src/styles.css`: サイズ、配色、傾き、背景
- `assets/background-kitchen-neutral.png`: 全スライド共通の背景画像
- `scripts/export.mjs`: Apple公式ベゼル適用とPNG出力
