import SwiftUI

struct AddRecipeView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var url = ""
  @State private var isSubmitting = false
  @State private var errorMessage: String?
  var body: some View {
    NavigationStack {
      Form {
        TextField("レシピURL", text: $url).textInputAutocapitalization(.never).keyboardType(.URL)
          .accessibilityIdentifier("add.url")
        if isSubmitting { ProgressView() }
        if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
      }
      .navigationTitle("URLから追加").toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { submit() }.disabled(
            isSubmitting || URL(string: url)?.scheme?.hasPrefix("http") != true
          ).accessibilityIdentifier("add.save")
        }
      }
    }
  }
  private func submit() {
    isSubmitting = true
    errorMessage = nil
    Task {
      do {
        _ = try await session.repository.add(url: url)
        dismiss()
      } catch { errorMessage = (error as? APIError)?.userMessage ?? error.localizedDescription }
      isSubmitting = false
    }
  }
}
