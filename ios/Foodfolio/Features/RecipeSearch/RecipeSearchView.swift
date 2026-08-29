import SwiftData
import SwiftUI

struct RecipeSearchView: View {
  @Environment(AppSession.self) private var session
  @Query(sort: \LocalTag.createdAt) private var tags: [LocalTag]
  @State private var query = ""
  @State private var genre: RecipeGenre?
  @State private var tagID: String?
  @State private var results: [LocalRecipe] = []
  @State private var historyRevision = 0

  private let columns = [
    GridItem(.flexible(), spacing: 12),
    GridItem(.flexible(), spacing: 12),
  ]

  var body: some View {
    ZStack {
      FoodfolioBackground()
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          searchField

          HStack(spacing: 10) {
            SearchFilterMenu(
              title: "ジャンル",
              selection: $genre,
              options: RecipeGenre.allCases.map { ($0, $0.rawValue) },
              accessibilityIdentifier: "search.genre"
            )
            SearchFilterMenu(
              title: "タグ",
              selection: $tagID,
              options: tags.map { ($0.id, $0.name) },
              accessibilityIdentifier: "search.tag"
            )
          }

          if query.isEmpty && genre == nil && tagID == nil {
            historySection
          } else if results.isEmpty {
            ContentUnavailableView.search(text: query)
              .frame(maxWidth: .infinity)
              .padding(.top, 56)
          } else {
            Text("検索結果")
              .font(.title3.bold())
              .foregroundStyle(FoodfolioTheme.ink)

            LazyVGrid(columns: columns, spacing: 20) {
              ForEach(results) { recipe in
                NavigationLink(destination: RecipeDetailView(recipe: recipe)) {
                  RecipeCard(recipe: recipe)
                }
                .buttonStyle(.plain)
              }
            }
          }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 40)
      }
      .scrollIndicators(.hidden)
    }
    .tint(FoodfolioTheme.terracotta)
    .navigationTitle("レシピ検索")
    .navigationBarTitleDisplayMode(.inline)
    .onChange(of: query) { _, _ in refresh() }
    .onChange(of: genre) { _, _ in refresh() }
    .onChange(of: tagID) { _, _ in refresh() }
    .onSubmit { session.history.add(query) }
  }

  private var searchField: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(FoodfolioTheme.secondaryInk)
      TextField("料理名・材料を検索", text: $query)
        .textFieldStyle(.plain)
        .submitLabel(.search)
        .accessibilityIdentifier("search.query")
      if !query.isEmpty {
        Button {
          query = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(FoodfolioTheme.secondaryInk)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("検索語を消去")
      }
    }
    .padding(.horizontal, 14)
    .frame(minHeight: 50)
    .glassEffect(
      .regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
  }

  private var historySection: some View {
    let values = session.history.values
    let _ = historyRevision

    return VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text("最近の検索")
          .font(.title3.bold())
          .foregroundStyle(FoodfolioTheme.ink)
        Spacer()
        if !values.isEmpty {
          Button("すべて削除", role: .destructive) {
            session.history.removeAll()
            historyRevision += 1
          }
          .font(.subheadline)
        }
      }
      .padding(.bottom, 6)

      if values.isEmpty {
        Text("検索した料理名や材料がここに残ります。")
          .font(.subheadline)
          .foregroundStyle(FoodfolioTheme.secondaryInk)
          .padding(.vertical, 12)
      } else {
        ForEach(values, id: \.self) { value in
          HStack(spacing: 12) {
            Button {
              query = value
            } label: {
              HStack(spacing: 12) {
                Image(systemName: "clock.arrow.circlepath")
                  .foregroundStyle(FoodfolioTheme.sage)
                Text(value)
                  .foregroundStyle(FoodfolioTheme.ink)
                Spacer(minLength: 0)
              }
              .contentShape(Rectangle())
              .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(role: .destructive) {
              session.history.remove(value)
              historyRevision += 1
            } label: {
              Image(systemName: "xmark")
                .font(.subheadline.weight(.semibold))
                .frame(width: 36, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(value) を検索履歴から削除")
            .accessibilityIdentifier("search.history.delete.\(value)")
          }
          Divider().overlay(FoodfolioTheme.hairline)
        }
      }
    }
  }

  private func refresh() {
    results = (try? session.repository.search(query: query, genre: genre, tagID: tagID)) ?? []
  }
}

private struct SearchFilterMenu<Option: Hashable>: View {
  let title: String
  @Binding var selection: Option?
  let options: [(value: Option, title: String)]
  let accessibilityIdentifier: String

  private var selectedTitle: String {
    guard let selection else { return title }
    return options.first(where: { $0.value == selection })?.title ?? title
  }

  var body: some View {
    Menu {
      Button {
        selection = nil
      } label: {
        if selection == nil {
          Label("すべて", systemImage: "checkmark")
        } else {
          Text("すべて")
        }
      }
      .accessibilityIdentifier("\(accessibilityIdentifier).option.all")

      Divider()

      ForEach(options, id: \.value) { option in
        Button {
          selection = option.value
        } label: {
          if selection == option.value {
            Label(option.title, systemImage: "checkmark")
          } else {
            Text(option.title)
          }
        }
        .accessibilityIdentifier("\(accessibilityIdentifier).option.\(option.title)")
      }
    } label: {
      HStack(spacing: 8) {
        Text(selectedTitle)
          .lineLimit(1)
        Spacer(minLength: 0)
        Image(systemName: "chevron.down")
          .font(.caption.weight(.semibold))
      }
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(selection == nil ? FoodfolioTheme.secondaryInk : FoodfolioTheme.ink)
      .padding(.horizontal, 14)
      .frame(maxWidth: .infinity, minHeight: 44)
      .glassEffect(.regular.interactive(), in: Capsule())
    }
    .accessibilityLabel(selectedTitle)
    .accessibilityIdentifier(accessibilityIdentifier)
  }
}
