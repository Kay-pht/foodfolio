import SwiftUI
import UIKit

struct AddRecipeView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
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
            .accessibilityIdentifier("add.title")

          Spacer()

          Button {
            dismiss()
          } label: {
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
          .accessibilityIdentifier("add.clipboardHeadline")

          Text(
            clipboardHasURL
              ? "下のペーストボタンを押すと、そのままレシピ帳に追加します。"
              : "レシピページでURLをコピーしてから、下のペーストボタンを押してください。"
          )
          .font(.footnote)
          .foregroundStyle(FoodfolioTheme.secondaryInk)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)

          if showManualEntry {
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
              .regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .transition(.opacity.combined(with: .move(edge: .top)))
          }

          if showManualEntry {
            Button("このURLで追加") { submit() }
              .buttonStyle(AddRecipePrimaryButtonStyle())
              .disabled(model.isSubmitting || !model.canSubmit)
              .accessibilityIdentifier("add.save")
              .transition(.opacity)
          } else {
            SystemPasteButton(isEnabled: !model.isSubmitting) { values in
              handlePaste(values)
            }
            .frame(maxWidth: .infinity, minHeight: 50, maxHeight: 50)
            .accessibilityLabel("クリップボードのURLを追加")
            .transition(.opacity)
          }

          Button(showManualEntry ? "入力欄を閉じる" : "別のURLを入力する") {
            withAnimation(.snappy) { showManualEntry.toggle() }
          }
          .font(.subheadline.weight(.medium))
          .foregroundStyle(FoodfolioTheme.terracotta)
          .buttonStyle(.plain)
          .disabled(model.isSubmitting)
          .accessibilityIdentifier("add.manual")

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
    .task(id: scenePhase) {
      guard scenePhase == .active else { return }
      await detectClipboardURL()
    }
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

private struct AddRecipePrimaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.body.weight(.semibold))
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity, minHeight: 50)
      .background(
        FoodfolioTheme.terracotta,
        in: Capsule(style: .continuous)
      )
      .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
  }
}

private struct SystemPasteButton: UIViewRepresentable {
  let isEnabled: Bool
  let onPaste: ([String]) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onPaste: onPaste)
  }

  func makeUIView(context: Context) -> UIPasteControl {
    let configuration = UIPasteControl.Configuration()
    configuration.displayMode = .iconAndLabel
    configuration.cornerStyle = .capsule
    configuration.baseForegroundColor = .white
    configuration.baseBackgroundColor = UIColor(FoodfolioTheme.terracotta)

    let control = UIPasteControl(configuration: configuration)
    control.target = context.coordinator
    control.accessibilityLabel = "クリップボードのURLを追加"
    control.accessibilityIdentifier = "add.paste"
    return control
  }

  func updateUIView(_ control: UIPasteControl, context: Context) {
    context.coordinator.onPaste = onPaste
    control.isEnabled = isEnabled
  }

  @MainActor final class Coordinator: NSObject, UIPasteConfigurationSupporting {
    var pasteConfiguration: UIPasteConfiguration? = UIPasteConfiguration(
      forAccepting: NSString.self)
    var onPaste: ([String]) -> Void

    init(onPaste: @escaping ([String]) -> Void) {
      self.onPaste = onPaste
    }

    func canPaste(_ itemProviders: [NSItemProvider]) -> Bool {
      itemProviders.contains { $0.canLoadObject(ofClass: NSString.self) }
    }

    func paste(itemProviders: [NSItemProvider]) {
      onPaste(UIPasteboard.general.strings ?? [])
    }
  }
}
