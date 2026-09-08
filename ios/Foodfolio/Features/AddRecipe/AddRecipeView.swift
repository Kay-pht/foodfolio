import SwiftUI
import UIKit

struct AddRecipeView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var model = AddRecipeViewModel()
  @State private var showManualEntry = false
  @State private var clipboardHasURL = false

  var body: some View {
    ZStack {
      FoodfolioBackground()

      VStack(spacing: 0) {
        HStack {
          Text("レシピを追加")
            .font(.title3.bold())
            .foregroundStyle(FoodfolioTheme.ink)

          Spacer()

          Button { dismiss() } label: {
            Image(systemName: "xmark")
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(FoodfolioTheme.secondaryInk)
              .frame(width: 34, height: 34)
              .glassEffect(.regular.interactive(), in: Circle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel("閉じる")
          .accessibilityIdentifier("add.close")
        }

        VStack(spacing: 16) {
          ZStack {
            Circle()
              .fill(FoodfolioTheme.terracotta.opacity(0.1))
              .frame(width: 64, height: 64)
            Image(systemName: "clipboard")
              .font(.system(size: 28, weight: .medium))
              .foregroundStyle(FoodfolioTheme.terracotta)
          }
          .padding(.top, 14)

          Text(
            clipboardHasURL
              ? "クリップボードに\nレシピのURLが見つかりました"
              : "クリップボードから\nレシピのURLを追加"
          )
          .font(.headline)
          .foregroundStyle(FoodfolioTheme.ink)
          .multilineTextAlignment(.center)

          Text(
            clipboardHasURL
              ? "下のペーストボタンを押すと、そのままレシピ帳に追加します。"
              : "レシピページでURLをコピーしてから、下のペーストボタンを押してください。"
          )
          .font(.footnote)
          .foregroundStyle(FoodfolioTheme.secondaryInk)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)

          PasteButton(payloadType: String.self) { values in
            handlePaste(values)
          }
          .labelStyle(.titleAndIcon)
          .buttonStyle(.borderedProminent)
          .buttonBorderShape(.capsule)
          .controlSize(.large)
          .tint(FoodfolioTheme.terracotta)
          .frame(maxWidth: .infinity, minHeight: 52)
          .disabled(model.isSubmitting)
          .accessibilityLabel("クリップボードのURLを追加")
          .accessibilityIdentifier("add.paste")

          Button(showManualEntry ? "入力欄を閉じる" : "別のURLを入力する") {
            withAnimation(.snappy) { showManualEntry.toggle() }
          }
          .font(.subheadline.weight(.medium))
          .foregroundStyle(FoodfolioTheme.terracotta)
          .buttonStyle(.plain)
          .disabled(model.isSubmitting)
          .accessibilityIdentifier("add.manual")

          if showManualEntry {
            VStack(spacing: 12) {
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
              .frame(minHeight: 52)
              .glassEffect(
                .regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

              Button("このURLで追加") { submit() }
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(
                  FoodfolioTheme.terracotta,
                  in: Capsule(style: .continuous)
                )
                .disabled(model.isSubmitting || !model.canSubmit)
                .opacity(model.isSubmitting || !model.canSubmit ? 0.45 : 1)
                .accessibilityIdentifier("add.save")
            }
            .transition(.opacity.combined(with: .move(edge: .top)))
          }

          if model.isSubmitting { ProgressView() }
          if let errorMessage = model.errorMessage {
            Text(errorMessage)
              .font(.subheadline)
              .foregroundStyle(.red)
              .multilineTextAlignment(.center)
          }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12)

        Spacer(minLength: 0)
      }
      .padding(20)
    }
    .task { await detectClipboardURL() }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private func handlePaste(_ values: [String]) {
    guard
      let text = values.first(where: { SharedURLParser.firstHTTPURL(in: $0) != nil }),
      model.usePastedText(text)
    else {
      _ = model.usePastedText("")
      return
    }
    submit()
  }

  private func submit() {
    Task {
      if await model.submit(add: { _ = try await session.addRecipe(url: $0) }) { dismiss() }
    }
  }

  @MainActor
  private func detectClipboardURL() async {
    guard !session.uiTesting else {
      clipboardHasURL = false
      return
    }

    let probableWebURL: PartialKeyPath<UIPasteboard.DetectedValues> = \.probableWebURL
    do {
      let patterns = try await UIPasteboard.general.detectedPatterns(for: [probableWebURL])
      clipboardHasURL = patterns.contains(probableWebURL)
    } catch {
      clipboardHasURL = false
    }
  }
}
