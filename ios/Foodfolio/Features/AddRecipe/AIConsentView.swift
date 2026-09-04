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
        Text(
          "レシピの材料や作り方を整理するため、保存するページの文章・動画・タイトルなどを外部AIサービスへ送信します。"
        )
        .accessibilityIdentifier("aiConsent.description")
        Text(
          "個人情報・非公開情報を含むページや、利用する権利のないコンテンツは保存しないでください。"
        )
        Link("送信先・情報の取り扱いを確認", destination: FoodfolioLinks.privacyPolicy)
          .accessibilityIdentifier("aiConsent.privacyPolicy")
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
