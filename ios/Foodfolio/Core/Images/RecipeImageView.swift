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

  struct Result: Sendable {
    enum Source: Equatable, Sendable { case local, remote }
    let data: Data
    let source: Source
  }

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

  func imageData(
    localImageData: Data?, imageURL: String?, originalURL: String
  ) async -> Result? {
    if let localImageData, Self.isValidImageData(localImageData) {
      return Result(data: localImageData, source: .local)
    }
    guard let data = await remoteImageData(imageURL: imageURL, originalURL: originalURL) else {
      return nil
    }
    return Result(data: data, source: .remote)
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
    return UIImage(data: data) != nil
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
    .task(id: imageLoadID) { await loadImage(expectedID: imageLoadID) }
  }

  private var imageLoadID: RecipeImageLoadID {
    RecipeImageLoadID(imageURL: recipe.imageUrl, originalURL: recipe.originalUrl)
  }

  @MainActor private func loadImage(expectedID: RecipeImageLoadID) async {
    let images = session.images
    var cached = await images.data(for: recipe.id)
    if let cachedData = cached, !RecipeImageLoader.isValidImageData(cachedData) {
      try? await images.remove(recipeID: recipe.id)
      cached = nil
    }

    if let cached, let decoded = UIImage(data: cached) {
      image = decoded
      return
    }

    guard !Task.isCancelled else { return }
    let request = RecipeImageRequest(
      recipeID: recipe.id, imageURL: expectedID.imageURL,
      originalURL: expectedID.originalURL)
    guard
      let remoteImage = await images.remoteImage(
        for: request,
        fetch: {
          await loader.remoteImageData(
            imageURL: request.imageURL, originalURL: request.originalURL)
        }),
      let decoded = UIImage(data: remoteImage.data)
    else { return }

    guard !Task.isCancelled, imageLoadID == expectedID else { return }
    do {
      guard try await images.store(remoteImage, recipeID: recipe.id) else {
        return
      }
    } catch {
      guard !Task.isCancelled, imageLoadID == expectedID else { return }
      // 保存だけに失敗した場合も、取得済み画像は現在の画面で表示する。
    }
    image = decoded
  }
}

private struct RecipeImageLoadID: Equatable {
  let imageURL: String?
  let originalURL: String
}
