import SwiftUI
import UIKit

struct RecipeImageView: View {
  @Environment(AppSession.self) private var session
  let recipe: LocalRecipe
  @State private var image: UIImage?

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Rectangle().fill(FoodfolioTheme.paper).overlay {
          Image(systemName: "fork.knife")
            .font(.largeTitle)
            .foregroundStyle(FoodfolioTheme.sage)
        }
      }
    }
    .clipped()
    .task(id: recipe.imageUrl) { await loadImage() }
  }

  private func loadImage() async {
    if let cached = await session.images.data(for: recipe.id), let decoded = UIImage(data: cached) {
      image = decoded
      return
    }
    guard let rawURL = recipe.imageUrl, let url = URL(string: rawURL) else { return }
    do {
      let (data, response) = try await URLSession.shared.data(from: url)
      guard let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode),
        data.count <= 10 * 1024 * 1024,
        let decoded = UIImage(data: data)
      else { return }
      try await session.images.store(data, recipeID: recipe.id)
      image = decoded
    } catch {
      // 画像が取得できなくても、オフライン閲覧の本文は利用できる。
    }
  }
}
