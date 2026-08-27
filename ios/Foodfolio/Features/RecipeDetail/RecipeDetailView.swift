import SwiftUI

struct RecipeDetailView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Bindable var recipe: LocalRecipe
  @State private var displayServings: Double?
  @State private var showTags = false
  @State private var showDelete = false
  @State private var errorMessage: String?

  var body: some View {
    List {
      RecipeImageView(recipe: recipe).frame(maxWidth: .infinity).frame(height: 240).listRowInsets(
        EdgeInsets())
      if recipe.analysisStatus == .failed {
        Section {
          Label("レシピの解析に問題がありました。", systemImage: "exclamationmark.triangle").foregroundStyle(
            .orange)
        }
      }
      Section { Text(recipe.title).font(.title2.bold()).accessibilityIdentifier("detail.title") }
      if let raw = recipe.servingsRaw {
        Section("人数") {
          Text(raw)
          if let base = recipe.servingsValue, base > 0 {
            Stepper(
              "表示人数: \(Int(displayServings ?? base))人",
              value: Binding(get: { displayServings ?? base }, set: { displayServings = $0 }),
              in: 1...20)
          }
        }
      }
      if let minutes = recipe.cookingTimeMinutes { Section("調理時間") { Text("\(minutes)分") } }
      if let genre = recipe.genre { Section("ジャンル") { Text(genre.rawValue) } }
      Section("タグ") {
        ScrollView(.horizontal) {
          HStack {
            ForEach(recipe.tags) {
              Text("#\($0.name)").padding(6).background(.quaternary, in: Capsule())
            }
            Button {
              showTags = true
            } label: {
              Image(systemName: "plus.circle")
            }.accessibilityIdentifier("detail.addTag")
          }
        }
      }
      if !recipe.ingredients.isEmpty {
        Section("材料") {
          ForEach(recipe.ingredients.sorted(by: { $0.sortOrder < $1.sortOrder })) { ingredient in
            HStack {
              Text(ingredient.name)
              Spacer()
              Text(scaledAmount(ingredient.amount) ?? "")
            }
          }
        }
      }
      if !recipe.steps.isEmpty {
        Section("作り方") {
          ForEach(recipe.steps.sorted(by: { $0.sortOrder < $1.sortOrder })) { step in
            Text("\(step.sortOrder + 1). \(step.text)")
          }
        }
      }
      Section("出典") {
        Link("元レシピを見る", destination: URL(string: recipe.originalUrl)!).accessibilityIdentifier(
          "detail.source")
      }
      Section { Button("レシピを削除", role: .destructive) { showDelete = true } }
    }
    .navigationTitle("レシピ詳細").toolbar {
      if ![.pending, .processing].contains(recipe.analysisStatus) {
        NavigationLink("編集", destination: RecipeEditView(recipe: recipe))
      }
    }
    .sheet(isPresented: $showTags) { TagPickerSheet(recipe: recipe) }
    .confirmationDialog("このレシピを完全に削除しますか？", isPresented: $showDelete) {
      Button("削除", role: .destructive) {
        Task {
          do {
            try await session.repository.delete(id: recipe.id)
            dismiss()
          } catch { errorMessage = error.localizedDescription }
        }
      }
    }
    .alert(
      "エラー",
      isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    ) {
      Button("OK") {}
    } message: {
      Text(errorMessage ?? "")
    }
    .onAppear { displayServings = recipe.servingsValue }
  }
  private func scaledAmount(_ amount: String?) -> String? {
    guard let base = recipe.servingsValue, let displayServings else { return amount }
    return AmountScaler.scale(amount, multiplier: displayServings / base)
  }
}

private struct TagPickerSheet: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  let recipe: LocalRecipe
  @State private var name = ""
  @State private var tags: [LocalTag] = []
  @State private var error: String?
  var body: some View {
    NavigationStack {
      List {
        Section("既存タグ") {
          ForEach(tags.filter { tag in !recipe.tags.contains(where: { $0.id == tag.id }) }) { tag in
            Button(tag.name) { attach(tag.id) }
          }
        }
        Section("新しいタグ") {
          TextField("タグ名", text: $name)
          Button("追加") { createAndAttach() }.disabled(
            name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        if let error { Text(error).foregroundStyle(.red) }
      }.navigationTitle("タグを追加").toolbar { Button("閉じる") { dismiss() } }.onAppear {
        tags = (try? session.repository.allTags()) ?? []
      }
    }
  }
  private func attach(_ id: String) {
    Task {
      do {
        _ = try await session.repository.attach(tagID: id, recipeID: recipe.id)
        dismiss()
      } catch { self.error = error.localizedDescription }
    }
  }
  private func createAndAttach() {
    Task {
      do {
        let tag = try await session.repository.createTag(name: name)
        _ = try await session.repository.attach(tagID: tag.id, recipeID: recipe.id)
        dismiss()
      } catch { self.error = error.localizedDescription }
    }
  }
}
