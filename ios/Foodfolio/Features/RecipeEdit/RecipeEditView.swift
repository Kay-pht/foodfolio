import SwiftUI

struct RecipeEditView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Bindable var recipe: LocalRecipe
  @State private var title: String
  @State private var genre: RecipeGenre?
  @State private var ingredients: [EditableIngredient]
  @State private var isSaving = false
  @State private var error: String?
  init(recipe: LocalRecipe) {
    self.recipe = recipe
    _title = State(initialValue: recipe.title)
    _genre = State(initialValue: recipe.genre)
    _ingredients = State(
      initialValue: recipe.ingredients.sorted(by: { $0.sortOrder < $1.sortOrder }).map {
        EditableIngredient(name: $0.name, amount: $0.amount ?? "")
      })
  }
  var body: some View {
    Form {
      Section("料理名") { TextField("料理名", text: $title) }
      Section("ジャンル") {
        Picker("ジャンル", selection: $genre) {
          Text("未設定").tag(nil as RecipeGenre?)
          ForEach(RecipeGenre.allCases, id: \.self) { Text($0.rawValue).tag(Optional($0)) }
        }
      }
      Section("材料") {
        ForEach($ingredients) { $item in
          HStack {
            TextField("材料", text: $item.name)
            TextField("分量", text: $item.amount)
          }
        }
        .onDelete { ingredients.remove(atOffsets: $0) }
        Button("材料を追加") { ingredients.append(EditableIngredient()) }
      }
      Section("タグ") {
        ForEach(recipe.tags) { tag in
          Button("#\(tag.name) を外す", role: .destructive) {
            Task { try? await session.repository.detach(tagID: tag.id, recipeID: recipe.id) }
          }
        }
      }
      if isSaving { ProgressView() }
      if let error { Text(error).foregroundStyle(.red) }
    }
    .navigationTitle("レシピ編集")
    .toolbar {
      Button("保存") { save() }
        .disabled(isSaving || title.trimmingCharacters(in: .whitespaces).isEmpty)
        .accessibilityIdentifier("edit.save")
    }
  }
  private func save() {
    isSaving = true
    Task {
      do {
        _ = try await session.repository.update(
          id: recipe.id, title: title, genre: genre,
          ingredients: ingredients.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { ($0.name, $0.amount.isEmpty ? nil : $0.amount) })
        dismiss()
      } catch { self.error = error.localizedDescription }
      isSaving = false
    }
  }
}

private struct EditableIngredient: Identifiable {
  let id = UUID()
  var name = ""
  var amount = ""
  init(name: String = "", amount: String = "") {
    self.name = name
    self.amount = amount
  }
}
