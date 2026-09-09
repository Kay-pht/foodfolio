import ImageIO
import LinkPresentation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct RecipeImageLoader: Sendable {
  static let maxImageBytes = 10 * 1024 * 1024

  typealias DirectImageFetcher = @Sendable (URL) async throws -> Data
  typealias MetadataImageFetcher = @Sendable (URL) async throws -> Data?

  private let directImageFetcher: DirectImageFetcher
  private let metadataImageFetcher: MetadataImageFetcher

  init(
    directImageFetcher: @escaping DirectImageFetcher = {
      try await RecipeImageLoader.downloadImageData(from: $0)
    },
    metadataImageFetcher: @escaping MetadataImageFetcher = {
      try await RecipeImageLoader.downloadMetadataImageData(from: $0)
    }
  ) {
    self.directImageFetcher = directImageFetcher
    self.metadataImageFetcher = metadataImageFetcher
  }

  func remoteImageData(imageURL rawImageURL: String?, originalURL rawOriginalURL: String) async
    -> Data?
  {
    if let imageURL = Self.webURL(from: rawImageURL) {
      do {
        let data = try await directImageFetcher(imageURL)
        if Self.isValidImageData(data) { return data }
      } catch {
        if Task.isCancelled { return nil }
      }
    }

    guard !Task.isCancelled, let originalURL = Self.webURL(from: rawOriginalURL) else { return nil }
    do {
      guard let data = try await metadataImageFetcher(originalURL), Self.isValidImageData(data)
      else { return nil }
      return data
    } catch {
      return nil
    }
  }

  static func isValidImageData(_ data: Data) -> Bool {
    guard !data.isEmpty, data.count <= maxImageBytes else { return false }
    return CGImageSourceCreateWithData(data as CFData, nil) != nil
  }

  private static func webURL(from rawURL: String?) -> URL? {
    guard let rawURL, let url = URL(string: rawURL), let scheme = url.scheme?.lowercased(),
      scheme == "https" || scheme == "http", url.host != nil
    else { return nil }
    return url
  }

  private static func downloadImageData(from url: URL) async throws -> Data {
    let (data, response) = try await URLSession.shared.data(from: url)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw URLError(.badServerResponse)
    }
    return data
  }

  private static func downloadMetadataImageData(from url: URL) async throws -> Data? {
    let metadataProvider = LPMetadataProvider()
    metadataProvider.timeout = 10
    let metadata = try await metadataProvider.startFetchingMetadata(for: url)
    guard let imageProvider = metadata.imageProvider else { return nil }
    guard
      let typeIdentifier = imageProvider.registeredTypeIdentifiers.first(where: {
        UTType($0)?.conforms(to: .image) == true
      })
    else { return nil }

    return try await withCheckedThrowingContinuation { continuation in
      imageProvider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: data)
        }
      }
    }
  }
}

struct RecipeImageView: View {
  @Environment(AppSession.self) private var session
  let recipe: LocalRecipe
  @State private var image: UIImage?
  private let loader = RecipeImageLoader()

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
    .task(id: imageLoadID) { await loadImage() }
  }

  private var imageLoadID: String { "\(recipe.imageUrl ?? "")|\(recipe.originalUrl)" }

  @MainActor private func loadImage() async {
    if let cached = await session.images.data(for: recipe.id), let decoded = UIImage(data: cached) {
      image = decoded
      return
    }

    guard
      let data = await loader.remoteImageData(
        imageURL: recipe.imageUrl, originalURL: recipe.originalUrl),
      let decoded = UIImage(data: data)
    else { return }

    try? await session.images.store(data, recipeID: recipe.id)
    image = decoded
  }
}
