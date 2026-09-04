import SwiftUI

struct AIConsentView: View {
  let onAccept: () -> Void
  let onDecline: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("AI解析のための情報送信")
          .font(.title2.bold())
          .accessibilityIdentifier("aiConsent.title")
        Text("レシピの材料・作り方を整理するため、外部AIサービスのZ.aiを利用します。")
        Text(
          "保存するURLの元ページの文章、対応する動画、タイトル等の情報を、FoodfolioのサーバーからZ.aiへ送信します。元の内容に含まれる氏名や顔なども送信される場合があります。"
        )
        Text(
          "Foodfolioのログイン用メールアドレスやパスワードを解析用に送ることはありません。個人情報・非公開情報を含むURLや、利用する権利のないコンテンツは保存しないでください。"
        )
        Link("プライバシーポリシーを確認", destination: FoodfolioLinks.privacyPolicy)
          .accessibilityIdentifier("aiConsent.privacyPolicy")
        Text(
          "同意はこのアカウント・この端末で記憶します。設定から取り消せます。同意しなくても、保存済みレシピは閲覧できます。"
        )
        .font(.footnote)
        .foregroundStyle(FoodfolioTheme.secondaryInk)
        Button("同意して解析・保存する", action: onAccept)
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("aiConsent.accept")
        Button("同意せずに戻る", action: onDecline)
          .accessibilityIdentifier("aiConsent.decline")
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(24)
    }
    .background(FoodfolioTheme.paper)
    .foregroundStyle(FoodfolioTheme.ink)
    .tint(FoodfolioTheme.terracotta)
  }
}
