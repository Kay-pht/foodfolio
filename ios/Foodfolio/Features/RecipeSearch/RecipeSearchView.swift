import SwiftData
import SwiftUI

struct RecipeSearchView: View {
  @Environment(AppSession.self) private var session
  @Query(sort: \LocalTag.createdAt) private var tags: [LocalTag]
  @State private var query = ""
  @State private var genre: RecipeGenre?
  @State private var tagID: String?
  @State private var results: [LocalRecipe] = []
  var body: some View {
    VStack {
      TextField("料理名・材料を検索", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal)
        .accessibilityIdentifier("search.query")
      HStack {
        Menu(genre?.rawValue ?? "ジャンル") {
          Button("すべて") { genre = nil }
          ForEach(RecipeGenre.allCases, id: \.self) { item in Button(item.rawValue) { genre = item }
          }
        }.accessibilityIdentifier("search.genre")
        Menu(tags.first(where: { $0.id == tagID })?.name ?? "タグ") {
          Button("すべて") { tagID = nil }
          ForEach(tags) { tag in Button(tag.name) { tagID = tag.id } }
        }.accessibilityIdentifier("search.tag")
      }
      if query.isEmpty && genre == nil && tagID == nil {
        List {
          Section("最近の検索") {
            ForEach(session.history.values, id: \.self) { value in Button(value) { query = value } }
            Button("すべて削除", role: .destructive) { session.history.removeAll() }
          }
        }
      } else if results.isEmpty {
        ContentUnavailableView.search(text: query)
      } else {
        List(results) { recipe in
          NavigationLink(recipe.title, destination: RecipeDetailView(recipe: recipe))
        }
      }
    }.navigationTitle("レシピ検索").onChange(of: query) { _, _ in refresh() }.onChange(of: genre) {
      _, _ in refresh()
    }.onChange(of: tagID) { _, _ in refresh() }.onSubmit { session.history.add(query) }
  }
  private func refresh() {
    results = (try? session.repository.search(query: query, genre: genre, tagID: tagID)) ?? []
  }
}
