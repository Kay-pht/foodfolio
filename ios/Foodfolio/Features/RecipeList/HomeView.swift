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

  private let columns = [GridItem(.flexible()), GridItem(.flexible())]
  var body: some View {
    NavigationStack {
      ZStack(alignment: .leading) {
        VStack {
          NavigationLink(destination: RecipeSearchView()) {
            Label("レシピを検索", systemImage: "magnifyingglass").frame(
              maxWidth: .infinity, alignment: .leading
            ).padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
          }.padding(.horizontal).accessibilityIdentifier("home.search")
          if recipes.isEmpty {
            ContentUnavailableView(
              "レシピがありません", systemImage: "book.closed", description: Text("右下の＋からURLを保存できます。"))
          } else {
            ScrollView {
              LazyVGrid(columns: columns) {
                ForEach(recipes) { recipe in
                  NavigationLink(destination: RecipeDetailView(recipe: recipe)) {
                    RecipeCard(recipe: recipe)
                  }
                }
              }.padding()
            }
          }
        }
        .offset(x: showDrawer ? 260 : 0).animation(.snappy, value: showDrawer)
        if showDrawer {
          DrawerView(show: $showDrawer).frame(width: 260).transition(.move(edge: .leading))
        }
      }
      .navigationTitle("Foodfolio")
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button {
            showDrawer.toggle()
          } label: {
            Image(systemName: "fork.knife.circle")
          }.accessibilityIdentifier("home.drawer")
        }
      }
      .overlay(alignment: .bottomTrailing) {
        Button {
          showAdd = true
        } label: {
          Image(systemName: "plus").font(.title2.bold()).frame(width: 58, height: 58).background(
            .tint, in: Circle()
          ).foregroundStyle(.white).shadow(radius: 4)
        }.padding().accessibilityIdentifier("home.add")
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

private struct RecipeCard: View {
  let recipe: LocalRecipe
  var body: some View {
    VStack(alignment: .leading) {
      GeometryReader { proxy in
        RecipeImageView(recipe: recipe)
          .frame(width: proxy.size.width, height: proxy.size.height)
      }
      .aspectRatio(1.2, contentMode: .fit)
      .clipShape(RoundedRectangle(cornerRadius: 12))
      Text(recipe.title).font(.headline).lineLimit(2).foregroundStyle(.primary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityIdentifier("recipe.card.\(recipe.id)")
  }
}

private struct DrawerView: View {
  @Binding var show: Bool
  var body: some View {
    NavigationStack {
      List {
        NavigationLink("設定", destination: SettingsView()).accessibilityIdentifier("drawer.settings")
        NavigationLink("アカウント", destination: AccountView()).accessibilityIdentifier(
          "drawer.account")
      }.navigationTitle("メニュー").toolbar { Button("閉じる") { show = false } }
    }.background(.background)
  }
}
