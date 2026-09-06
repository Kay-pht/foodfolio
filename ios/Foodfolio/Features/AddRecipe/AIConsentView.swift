import SwiftUI

struct AIConsentRootView: View {
  @Environment(AppSession.self) private var session
  @State private var isAccepting = false
  @State private var error: String?

  var body: some View {
    Group {
      if !session.aiConsent.isGranted
        || (session.user != nil && !session.isAIConsentReadyForAuthenticatedUse)
      {
        AIConsentView(
          isWorking: isAccepting,
          error: error ?? session.globalError,
          onAccept: accept)
      } else {
        RootView()
      }
    }
  }

  private func accept() {
    guard !isAccepting else { return }
    isAccepting = true
    error = nil
    session.globalError = nil
    Task {
      do {
        try await session.acceptAIConsent()
      } catch {
        self.error = "同意情報を保存できませんでした。通信状況を確認して、もう一度お試しください。"
      }
      isAccepting = false
    }
  }
}

struct AIConsentView: View {
  let isWorking: Bool
  let error: String?
  let onAccept: () -> Void
  @State private var showsDeclineAlert = false

  var body: some View {
    ZStack {
      FoodfolioBackground()

      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "sparkles")
              .font(.system(size: 38, weight: .medium))
              .foregroundStyle(FoodfolioTheme.terracotta)

            Text("AI解析について")
              .font(.title.bold())
              .accessibilityIdentifier("aiConsent.title")

            Text("保存したレシピのURLやレシピ情報を外部AIサービスへ送信し、解析します。")
              .font(.body)
              .foregroundStyle(FoodfolioTheme.secondaryInk)
              .accessibilityIdentifier("aiConsent.description")
          }

          VStack(alignment: .leading, spacing: 14) {
            consentItem(
              icon: "arrow.up.right.circle",
              text: "AI解析のため、保存したURLや解析に必要なレシピ情報を外部AIサービスへ送信します。")
            consentItem(
              icon: "brain.head.profile",
              text: "Foodfolioから、AI事業者の学習利用を目的とした追加のオプトインは行いません。最新の取り扱いはプライバシーポリシーで確認できます。")
            consentItem(
              icon: "lock.shield",
              text: "送信先や情報の取り扱いは、利用する外部サービスや仕様変更に応じて更新される場合があります。")
          }
          .padding(18)
          .glassEffect(
            .regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

          Link("プライバシーポリシーを確認", destination: FoodfolioLinks.privacyPolicy)
            .font(.subheadline.weight(.semibold))
            .accessibilityIdentifier("aiConsent.privacyPolicy")

          if let error {
            Text(error)
              .font(.subheadline)
              .foregroundStyle(.red)
              .accessibilityIdentifier("aiConsent.error")
          }

          VStack(spacing: 12) {
            Button(action: onAccept) {
              Group {
                if isWorking {
                  ProgressView()
                } else {
                  Text("AI解析に同意してはじめる")
                }
              }
              .font(.body.weight(.semibold))
              .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.glassProminent)
            .tint(FoodfolioTheme.terracotta)
            .disabled(isWorking)
            .accessibilityIdentifier("aiConsent.accept")

            Button("同意しない") { showsDeclineAlert = true }
              .buttonStyle(.plain)
              .font(.subheadline.weight(.medium))
              .foregroundStyle(FoodfolioTheme.secondaryInk)
              .frame(maxWidth: .infinity, minHeight: 44)
              .disabled(isWorking)
              .accessibilityIdentifier("aiConsent.decline")
          }
        }
        .frame(maxWidth: 560, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.top, 52)
        .padding(.bottom, 32)
      }
    }
    .foregroundStyle(FoodfolioTheme.ink)
    .tint(FoodfolioTheme.terracotta)
    .alert("同意しない場合", isPresented: $showsDeclineAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("FoodfolioではAI解析が主要機能として使用されるため、同意いただけない場合はアプリをご利用いただけません。")
    }
  }

  private func consentItem(icon: String, text: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: icon)
        .foregroundStyle(FoodfolioTheme.sage)
        .frame(width: 22)
      Text(text)
        .font(.subheadline)
        .foregroundStyle(FoodfolioTheme.secondaryInk)
    }
  }
}
