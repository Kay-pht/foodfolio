import SwiftData
import SwiftUI

struct RootView: View {
  @Environment(AppSession.self) private var session
  var body: some View {
    Group { if session.user == nil { AuthView() } else { HomeView() } }.alert(
      "エラー",
      isPresented: Binding(
        get: { session.globalError != nil }, set: { if !$0 { session.globalError = nil } })
    ) {
      Button("OK") {}
    } message: {
      Text(session.globalError ?? "")
    }
  }
}

struct HomeView: View {
  @Environment(AppSession.self) private var session
  @Query(sort: \LocalRecipe.createdAt, order: .reverse) private var recipes: [LocalRecipe]
  @State private var showAdd = false
  @State private var showDrawer = false

  private let columns = [
    GridItem(.flexible(), spacing: 12),
    GridItem(.flexible(), spacing: 12),
  ]

  var body: some View {
    NavigationStack {
      ZStack(alignment: .leading) {
        FoodfolioBackground()
        VStack(spacing: 0) {
          VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
              Text("わたしのレシピ")
                .font(.title2.bold())
                .foregroundStyle(FoodfolioTheme.ink)
              Text("いつもの味を、ここに。")
                .font(.subheadline)
                .foregroundStyle(FoodfolioTheme.secondaryInk)
            }

            NavigationLink(destination: RecipeSearchView()) {
              HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                Text("料理名・材料から探す")
                Spacer(minLength: 0)
              }
              .font(.body.weight(.medium))
              .foregroundStyle(FoodfolioTheme.secondaryInk)
              .padding(.horizontal, 16)
              .frame(maxWidth: .infinity, minHeight: 52)
              .glassEffect(
                .regular.interactive(), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("home.search")
          }
          .padding(.horizontal, 20)
          .padding(.top, 8)
          .padding(.bottom, 12)

          if recipes.isEmpty {
            Spacer()
            VStack(spacing: 12) {
              Image(systemName: "book.pages")
                .font(.system(size: 38, weight: .medium))
                .foregroundStyle(FoodfolioTheme.sage)
              Text("まだレシピがありません")
                .font(.headline)
                .foregroundStyle(FoodfolioTheme.ink)
              Text("右下の＋から、最初のレシピを保存できます。")
                .font(.subheadline)
                .foregroundStyle(FoodfolioTheme.secondaryInk)
                .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            Spacer()
          } else {
            ScrollView {
              LazyVGrid(columns: columns, spacing: 20) {
                ForEach(recipes) { recipe in
                  NavigationLink(destination: RecipeDetailView(recipe: recipe)) {
                    RecipeCard(recipe: recipe)
                  }
                  .buttonStyle(.plain)
                }
              }
              .padding(.horizontal, 20)
              .padding(.top, 4)
              .padding(.bottom, 96)
            }
            .scrollIndicators(.hidden)
          }
        }
        .offset(x: showDrawer ? 260 : 0)
        .animation(.snappy, value: showDrawer)

        if showDrawer {
          DrawerView(show: $showDrawer)
            .frame(width: 260)
            .transition(.move(edge: .leading))
        }
      }
      .tint(FoodfolioTheme.terracotta)
      .navigationTitle("")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button {
            showDrawer.toggle()
          } label: {
            Image(systemName: "fork.knife.circle")
          }
          .accessibilityLabel("メニュー")
          .accessibilityIdentifier("home.drawer")
        }
        ToolbarItem(placement: .topBarLeading) {
          Text("foodfolio")
            .font(.headline.weight(.semibold))
            .foregroundStyle(FoodfolioTheme.ink)
            .fixedSize(horizontal: true, vertical: false)
            .accessibilityIdentifier("home.brandTitle")
        }
      }
      .overlay(alignment: .bottomTrailing) {
        Button {
          showAdd = true
        } label: {
          Image(systemName: "plus")
            .font(.title2.bold())
            .foregroundStyle(.white)
            .frame(width: 58, height: 58)
            .glassEffect(.regular.tint(FoodfolioTheme.terracotta).interactive(), in: Circle())
        }
        .buttonStyle(.plain)
        .padding(20)
        .accessibilityLabel("レシピを追加")
        .accessibilityIdentifier("home.add")
      }
      .sheet(isPresented: $showAdd) { AddRecipeView() }
      .refreshable { await session.synchronize() }
      .task { if !session.uiTesting { await session.synchronize() } }
      .navigationDestination(
        item: Binding(get: { session.pendingRecipeID }, set: { session.pendingRecipeID = $0 })
      ) { recipeID in
        if let recipe = try? session.repository.recipe(id: recipeID) {
          RecipeDetailView(recipe: recipe)
        } else {
          ContentUnavailableView("レシピが見つかりません", systemImage: "book.closed")
        }
      }
    }
  }
}

struct RecipeCard: View {
  let recipe: LocalRecipe

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      GeometryReader { proxy in
        RecipeImageView(recipe: recipe)
          .frame(width: proxy.size.width, height: proxy.size.height)
      }
      .aspectRatio(1.18, contentMode: .fit)
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

      Text(recipe.title)
        .font(.headline)
        .lineLimit(2)
        .foregroundStyle(FoodfolioTheme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .accessibilityIdentifier("recipe.card.\(recipe.id)")
  }
}

private struct DrawerView: View {
  @Binding var show: Bool

  var body: some View {
    NavigationStack {
      List {
        NavigationLink(destination: SettingsView()) {
          Label("設定", systemImage: "bell.badge")
        }
        .accessibilityIdentifier("drawer.settings")

        NavigationLink(destination: AccountView()) {
          Label("アカウント", systemImage: "person.crop.circle")
        }
        .accessibilityIdentifier("drawer.account")
      }
      .scrollContentBackground(.hidden)
      .background(FoodfolioTheme.paper)
      .navigationTitle("メニュー")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { Button("閉じる") { show = false } }
    }
    .tint(FoodfolioTheme.terracotta)
  }
}
