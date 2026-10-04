import SwiftUI

struct RecipeEditView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Bindable var recipe: LocalRecipe
  @State private var title: String
  @State private var genre: RecipeGenre?
  @State private var ingredients: [EditableIngredient]
  @State private var steps: [EditableRecipeStep]
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
    _steps = State(
      initialValue: recipe.steps.sorted(by: { $0.sortOrder < $1.sortOrder }).map {
        EditableRecipeStep(text: $0.text)
      })
  }
  var body: some View {
    Form {
      Section("料理名") {
        TextField("料理名", text: $title).accessibilityIdentifier("edit.title")
      }
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
      Section("作り方") {
        ForEach($steps) { $step in
          let index = steps.firstIndex(where: { $0.id == step.id }) ?? 0
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text("手順\(index + 1)").font(.headline)
              Spacer()
              Button {
                steps.swapAt(index, index - 1)
              } label: {
                Image(systemName: "arrow.up")
              }
              .disabled(index == 0)
              .accessibilityLabel("手順\(index + 1)を上へ移動")
              .accessibilityIdentifier("edit.step.\(index).up")
              Button {
                steps.swapAt(index, index + 1)
              } label: {
                Image(systemName: "arrow.down")
              }
              .disabled(index == steps.count - 1)
              .accessibilityLabel("手順\(index + 1)を下へ移動")
              .accessibilityIdentifier("edit.step.\(index).down")
              Button(role: .destructive) {
                steps.remove(at: index)
              } label: {
                Image(systemName: "trash")
              }
              .accessibilityLabel("手順\(index + 1)を削除")
              .accessibilityIdentifier("edit.step.\(index).delete")
            }
            .buttonStyle(.borderless)
            TextField("作り方を入力", text: $step.text, axis: .vertical)
              .lineLimit(3...10)
              .accessibilityLabel("手順\(index + 1)の作り方")
              .accessibilityIdentifier("edit.step.\(index).text")
          }
        }
        Button("手順を追加") { steps.append(EditableRecipeStep()) }
          .accessibilityIdentifier("edit.addStep")
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
    .disabled(isSaving)
    .scrollDismissesKeyboard(.interactively)
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
            .map { ($0.name, $0.amount.isEmpty ? nil : $0.amount) },
          steps: steps.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty })
        dismiss()
      } catch { self.error = error.localizedDescription }
      isSaving = false
    }
  }
}

private struct EditableRecipeStep: Identifiable {
  let id = UUID()
  var text = ""
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
