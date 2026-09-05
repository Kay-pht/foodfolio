# Share Extension 外部設定

Foodfolio の共有シート連携では、アプリ本体と Share Extension の間で App Group `group.com.keyukt.foodfolio` を共有し、AI同意状態とFirebase Auth状態を参照する。

## Apple Developer 側で必要な設定

既存の main app Bundle ID は `com.keyukt.foodfolio` のまま維持する。

1. App Group `group.com.keyukt.foodfolio` を作成する。
2. 既存 App ID `com.keyukt.foodfolio` に App Groups capability を有効化し、上記App Groupを割り当てる。
3. Share Extension 用 App ID `com.keyukt.foodfolio.ShareExtension` を作成する。
4. Share Extension App ID に App Groups capability を有効化し、同じApp Groupを割り当てる。
5. Release用Provisioning Profileを再生成する。
   - main app: `Foodfolio App Store Connect`
   - Share Extension: `Foodfolio Share Extension App Store Connect`

Firebase AuthはFirebase公式の `useUserAccessGroup` で同じApp Groupを指定して共有する。既存ユーザーについてはmain app起動時に既存のFirebase userを共有領域へ移行する。

## Firebase 側で必要な設定

Share Extension Bundle ID `com.keyukt.foodfolio.ShareExtension` をFirebase iOS appとして登録し、そのBundle ID用に発行された `GoogleService-Info.plist` を `ios/FoodfolioShareExtension/GoogleService-Info.plist` へ配置する。

このファイルはBundle IDごとにFirebase Consoleから発行する必要があるため、リポジトリにはダミー値をコミットしない。

## 動作確認

- Safari / ChromeからURLを共有するとFoodfolioが共有候補に表示される。
- YouTube / TikTok / InstagramなどからURLまたはURLを含むテキストが共有された場合、最初のHTTP/HTTPS URLを1件保存する。
- ログイン済みかつAI解析同意済みの場合、`レシピを追加中…` → `追加しました` と表示して閉じる。
- 未ログイン時は `Foodfolioアプリでログインしてください。` と表示する。
- AI解析未同意時は `FoodfolioアプリでAI解析への同意を行ってください。` と表示する。
- URLを取得できない場合は `URLを取得できませんでした。` と表示する。
