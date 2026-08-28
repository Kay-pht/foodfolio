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
      HStack(spacing: 12) {
        SearchFilterPicker(
          title: "ジャンル", selection: $genre,
          options: RecipeGenre.allCases.map { ($0, $0.rawValue) },
          accessibilityIdentifier: "search.genre")
        SearchFilterPicker(
          title: "タグ", selection: $tagID,
          options: tags.map { ($0.id, $0.name) },
          accessibilityIdentifier: "search.tag")
      }
      .padding(.horizontal)
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

private struct SearchFilterPicker<Option: Hashable>: View {
  let title: String
  @Binding var selection: Option?
  let options: [(value: Option, title: String)]
  let accessibilityIdentifier: String
  @State private var isPresented = false

  private var selectedTitle: String {
    guard let selection else { return title }
    return options.first(where: { $0.value == selection })?.title ?? title
  }

  var body: some View {
    Button {
      isPresented = true
    } label: {
      HStack(spacing: 8) {
        Text(selectedTitle)
          .lineLimit(1)
        Spacer(minLength: 0)
        Image(systemName: "chevron.down")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
      }
      .foregroundStyle(selection == nil ? .secondary : .primary)
      .padding(.horizontal, 12)
      .frame(maxWidth: .infinity, minHeight: 44)
      .background(.background, in: RoundedRectangle(cornerRadius: 10))
      .overlay {
        RoundedRectangle(cornerRadius: 10)
          .stroke(.secondary.opacity(0.35), lineWidth: 1)
      }
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier(accessibilityIdentifier)
    .sheet(isPresented: $isPresented) {
      NavigationStack {
        Picker(title, selection: $selection) {
          Text("すべて").tag(Optional<Option>.none)
          ForEach(options, id: \.value) { option in
            Text(option.title).tag(Optional(option.value))
          }
        }
        .pickerStyle(.wheel)
        .accessibilityIdentifier("\(accessibilityIdentifier).picker")
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("完了") { isPresented = false }
              .accessibilityIdentifier("\(accessibilityIdentifier).done")
          }
        }
      }
      .presentationDetents([.height(280)])
      .presentationDragIndicator(.visible)
    }
  }
}
