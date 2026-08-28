import SwiftUI

struct AddRecipeView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var model = AddRecipeViewModel()
  var body: some View {
    NavigationStack {
      Form {
        TextField("レシピURL", text: $model.url).textInputAutocapitalization(.never).keyboardType(.URL)
          .accessibilityIdentifier("add.url")
        if model.isSubmitting { ProgressView() }
        if let errorMessage = model.errorMessage { Text(errorMessage).foregroundStyle(.red) }
      }
      .navigationTitle("URLから追加").toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { submit() }.disabled(model.isSubmitting || !model.canSubmit)
            .accessibilityIdentifier("add.save")
        }
      }
    }
  }
  private func submit() {
    Task {
      if await model.submit(add: { _ = try await session.repository.add(url: $0) }) { dismiss() }
    }
  }
}
