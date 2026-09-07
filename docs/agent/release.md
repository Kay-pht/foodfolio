# リリース管理

## 初回 TestFlight の確定方針

- 初回 TestFlight では現在の GCP / Firebase / Neon バックエンド環境を利用する。
- Push 通知を必須機能とする。
- Firebase Analytics と Firebase Crashlytics は導入せず、リリース前に iOS target から両 SDK の依存を外して、TestFlight 標準のセッション、クラッシュ、フィードバックを利用する。
- 独自利用規約は作成せず、Apple 標準 EULA を使用する。
- 認証の主要分岐は自動テストし、Apple / Google / メールの正常系を実機で各 1 回、Apple token 失効を含むアカウント削除を実機で 1 回確認する。

## 配布状況の管理

- 利用者の操作または実行環境の挙動が変わる変更は、PR 作成前に `tasks/unreleased.md` へ追加する。PR 作成後は PR リンク、main へ merge 後は merge commit を追記する。
- CI、テスト、ドキュメント、開発専用ツールだけの変更は、配布物や稼働環境の挙動を変えない限り配布状況の対象にしない。
- 各項目には必要な反映先を明記する。反映先は変更内容に応じて TestFlight 内部テスト、App Store 本番、対象の Cloud Run 環境から選び、不要な反映先を形式的に追加しない。
- TestFlight は対象 build が内部テスターグループへ割り当てられた時点、App Store 本番は公開を確認した時点、Cloud Run は対象 revision へのデプロイ成功と traffic を確認した時点で反映済みとする。実機確認はこの移動条件に含めず、必要な検証を `tasks/todo.md` などで別に管理する。
- 必要な反映先をすべて証跡付きで確認した項目だけを `tasks/released.md` へ移す。一部だけ反映済みの場合は `tasks/unreleased.md` に残し、反映済みの行だけチェックする。
- 反映日は日本時間（JST）の `YYYY-MM-DD` で記録する。iOS は `version (build)` と App Store Connect の Build ID、Cloud Run は Git SHA、service 名、revision 名を記録する。
- 初期 TestFlight が現在の dev バックエンドを利用している間も、iOS build への反映と Cloud Run への反映を別々の反映先として扱う。
