import SwiftUI

struct AddRecipeView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var model = AddRecipeViewModel()
  @State private var consentUserID: String?
  @State private var showsAIConsent = false

  var body: some View {
    NavigationStack {
      if showsAIConsent {
        AIConsentView(
          onAccept: {
            guard let userID = consentUserID, session.grantAIConsent(for: userID) else {
              showsAIConsent = false
              model.errorMessage = AIConsentError.required.localizedDescription
              return
            }
            showsAIConsent = false
            submit()
          },
          onDecline: { showsAIConsent = false }
        )
      } else {
        ZStack {
          FoodfolioBackground()

          VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
              Text("レシピ帳に追加")
                .font(.title2.bold())
                .foregroundStyle(FoodfolioTheme.ink)
              Text("ネットで見つけたレシピのURLを貼り付けてください。")
                .font(.subheadline)
                .foregroundStyle(FoodfolioTheme.secondaryInk)
            }

            HStack(spacing: 10) {
              Image(systemName: "link")
                .foregroundStyle(FoodfolioTheme.sage)
              TextField("https://...", text: $model.url)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textFieldStyle(.plain)
                .accessibilityIdentifier("add.url")
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 54)
            .glassEffect(
              .regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            Label("保存後はすぐ一覧に戻り、解析はバックグラウンドで進みます。", systemImage: "sparkles")
              .font(.footnote)
              .foregroundStyle(FoodfolioTheme.secondaryInk)

            if model.isSubmitting { ProgressView() }
            if let errorMessage = model.errorMessage {
              Text(errorMessage)
                .font(.subheadline)
                .foregroundStyle(.red)
            }

            Spacer()
          }
          .padding(20)
        }
        .tint(FoodfolioTheme.terracotta)
        .navigationTitle("レシピを追加")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button("保存") { requestSubmission() }
              .disabled(model.isSubmitting || !model.canSubmit)
              .accessibilityIdentifier("add.save")
          }
        }
      }
    }
    .presentationDetents(showsAIConsent ? [.large] : [.medium])
    .presentationDragIndicator(.visible)
  }

  private func requestSubmission() {
    if session.aiConsent.isGranted(for: session.user?.uid) {
      submit()
    } else {
      consentUserID = session.user?.uid
      showsAIConsent = true
    }
  }

  private func submit() {
    Task {
      if await model.submit(add: { _ = try await session.addRecipe(url: $0) }) { dismiss() }
    }
  }
}
