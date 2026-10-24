# Share Extension 外部設定

Foodfolio の共有シート連携では、アプリ本体と Share Extension の間で App Group `group.com.keyukt.foodfolio` を共有し、Firebase Auth状態を参照する。AI利用の専用同意状態は現行実装では持たない。

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
- ログイン済みの場合、共有URLを確認して送信すると `確認中` とスピナーを表示する。
- Backendが追加を受け付けた場合は `✓ 送信` と `Foodfolioへの追加を受け付けました。` を表示し、`閉じる` で共有シートを終了する。
- 再試行可能な失敗では `再試行` を表示し、同じURLを再送できる。
- 未ログイン時は `Foodfolioアプリでログインしてください。` と表示する。
- URLを取得できない場合は `URLを取得できませんでした。` と表示する。

## 初期表示と本文の読み取り専用化

`SLComposeServiceViewController` は編集可能な `textView` を作成し、入力とシートの表示処理を管理する。`viewDidLoad` では `isEditable` を無効化せず、`presentationAnimationDidFinish` で superclass の処理後に読み取り専用へ切り替える。表示途中の入力・貼り付け・削除は text view delegate で拒否し、表示された確認内容と実際に送信するURLの食い違いを防ぐ。表示完了までの秒数を仮定するタイマーや private API は使用しない。

2026-10-24のiOS 27実機調査では、従来の `viewDidLoad` 内の `textView.isEditable = false` を含む実装で、URL取得成功・Postの内部有効化後にも白画面が続いた。同じ白画面のコントローラーで診断用に編集を許可して first responder を要求すると、数秒後に文字とボタンが表示された。初期表示前に入力経路を無効化する処理を、表示完了後へ移すのが修正の対象である。認証やAPI送信はPost後の処理であり、この初期表示の段階では実行しない。

実機のビュー状態も記録した。失敗中は本文がすでに first responder でも、標準シートの `UILayoutContainerView.isHidden` が `true` のままだった。起動約3.95秒後に編集許可を切り替えた同じ画面では、約4.46秒後に表示完了フックが呼ばれ、`isHidden` が `false` になった。修正版では、約1.05秒 / 1.13秒で表示完了フックに入り、本文が読み取り専用になった後もシートは表示されたままだった。ユーザーによる繰り返し共有でも表示できた。

編集拒否は従来の単一範囲のdelegateメソッドと、iOS 26以降の複数範囲のdelegateメソッドの両方で行う。

別アプリIDの診断版は、同じソースのDebug / Release・英語 / 日本語のいずれでも表示できたため、それらの設定だけを発生条件とは断定しない。また、標準UIの `_hasPresentedSheet == NO` ログは正常起動時にも存在し、そのログ単独を障害の証拠にはしない。Apple内部の分岐条件まで断定せず、再現端末での入力状態の変更と画面の回復を根拠とする。

コントローラーの初期入力状態、表示途中の編集拒否、表示完了後の読み取り専用化は `FoodfolioShareExtensionTests/SharePresentationTests.swift` で実行時に検証し、iOS全体検証にも含める。
