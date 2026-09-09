import Foundation
import XCTest

@testable import Foodfolio

final class RecipeImageLoaderTests: XCTestCase {
  func testStoredImageURLIsPreferredOverOriginalURLMetadata() async throws {
    let directURL = try XCTUnwrap(URL(string: "https://cdn.example.com/recipe.png"))
    let recorder = ImageFetchRecorder()
    let imageData = Self.validPNGData
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        return imageData
      },
      metadataImageFetcher: { url in
        await recorder.recordMetadata(url)
        return imageData
      })

    let result = await loader.remoteImageData(
      imageURL: directURL.absoluteString, originalURL: "https://example.com/recipe")

    XCTAssertEqual(result, imageData)
    XCTAssertEqual(await recorder.directURLs, [directURL])
    XCTAssertTrue(await recorder.metadataURLs.isEmpty)
  }

  func testOriginalURLMetadataRecoversImageWhenStoredImageURLFails() async throws {
    let directURL = try XCTUnwrap(URL(string: "https://cdn.example.com/expired.png"))
    let originalURL = try XCTUnwrap(URL(string: "https://example.com/recipe"))
    let recorder = ImageFetchRecorder()
    let imageData = Self.validPNGData
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        throw URLError(.badServerResponse)
      },
      metadataImageFetcher: { url in
        await recorder.recordMetadata(url)
        return imageData
      })

    let result = await loader.remoteImageData(
      imageURL: directURL.absoluteString, originalURL: originalURL.absoluteString)

    XCTAssertEqual(result, imageData)
    XCTAssertEqual(await recorder.directURLs, [directURL])
    XCTAssertEqual(await recorder.metadataURLs, [originalURL])
  }

  func testReturnsNilWhenStoredAndOriginalImageRecoveryFail() async throws {
    let directURL = try XCTUnwrap(URL(string: "https://cdn.example.com/not-an-image"))
    let originalURL = try XCTUnwrap(URL(string: "https://example.com/recipe"))
    let recorder = ImageFetchRecorder()
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        return Data("not an image".utf8)
      },
      metadataImageFetcher: { url in
        await recorder.recordMetadata(url)
        return nil
      })

    let result = await loader.remoteImageData(
      imageURL: directURL.absoluteString, originalURL: originalURL.absoluteString)

    XCTAssertNil(result)
    XCTAssertEqual(await recorder.directURLs, [directURL])
    XCTAssertEqual(await recorder.metadataURLs, [originalURL])
  }

  private static let validPNGData = Data(
    base64Encoded:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  )!
}

private actor ImageFetchRecorder {
  private(set) var directURLs: [URL] = []
  private(set) var metadataURLs: [URL] = []

  func recordDirect(_ url: URL) { directURLs.append(url) }
  func recordMetadata(_ url: URL) { metadataURLs.append(url) }
}
