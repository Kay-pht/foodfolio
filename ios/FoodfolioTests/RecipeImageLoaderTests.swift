import Foundation
import XCTest

@testable import Foodfolio

final class RecipeImageLoaderTests: XCTestCase {
  func testValidLocalImageIsPreferredWithoutRemoteRequests() async {
    let recorder = ImageFetchRecorder()
    let imageData = Self.validPNGData
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        return imageData
      },
      imageURLResolver: {
        await recorder.recordResolution()
        return "https://cdn.example.com/resolved.png"
      })

    let result = await loader.imageData(
      localImageData: imageData, imageURL: "https://cdn.example.com/new.png")
    let directURLs = await recorder.directURLs
    let resolutionCalls = await recorder.resolutionCalls

    XCTAssertEqual(result?.data, imageData)
    XCTAssertEqual(result?.source, .local)
    XCTAssertTrue(directURLs.isEmpty)
    XCTAssertEqual(resolutionCalls, 0)
  }

  func testInvalidLocalImageFallsBackToStoredImageURL() async throws {
    let directURL = try XCTUnwrap(URL(string: "https://cdn.example.com/recipe.png"))
    let recorder = ImageFetchRecorder()
    let imageData = Self.validPNGData
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        return imageData
      },
      imageURLResolver: {
        await recorder.recordResolution()
        return "https://cdn.example.com/resolved.png"
      })

    let result = await loader.imageData(
      localImageData: Data("not an image".utf8), imageURL: directURL.absoluteString)
    let directURLs = await recorder.directURLs
    let resolutionCalls = await recorder.resolutionCalls

    XCTAssertEqual(result?.data, imageData)
    XCTAssertEqual(result?.source, .remote)
    XCTAssertEqual(directURLs, [directURL])
    XCTAssertEqual(resolutionCalls, 0)
  }

  func testStoredImageURLIsPreferredOverBackendResolution() async throws {
    let directURL = try XCTUnwrap(URL(string: "https://cdn.example.com/recipe.png"))
    let recorder = ImageFetchRecorder()
    let imageData = Self.validPNGData
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        return imageData
      },
      imageURLResolver: {
        await recorder.recordResolution()
        return "https://cdn.example.com/resolved.png"
      })

    let result = await loader.remoteImageData(imageURL: directURL.absoluteString)
    let directURLs = await recorder.directURLs
    let resolutionCalls = await recorder.resolutionCalls

    XCTAssertEqual(result, imageData)
    XCTAssertEqual(directURLs, [directURL])
    XCTAssertEqual(resolutionCalls, 0)
  }

  func testBackendResolutionRecoversImageWhenStoredImageURLFails() async throws {
    let expiredURL = try XCTUnwrap(URL(string: "https://cdn.example.com/expired.png"))
    let resolvedURL = try XCTUnwrap(URL(string: "https://cdn.example.com/resolved.png"))
    let recorder = ImageFetchRecorder()
    let imageData = Self.validPNGData
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        if url == expiredURL { throw URLError(.badServerResponse) }
        return imageData
      },
      imageURLResolver: {
        await recorder.recordResolution()
        return resolvedURL.absoluteString
      })

    let result = await loader.remoteImageData(imageURL: expiredURL.absoluteString)
    let directURLs = await recorder.directURLs
    let resolutionCalls = await recorder.resolutionCalls

    XCTAssertEqual(result, imageData)
    XCTAssertEqual(directURLs, [expiredURL, resolvedURL])
    XCTAssertEqual(resolutionCalls, 1)
  }

  func testReturnsNilWhenStoredAndResolvedImageRecoveryFail() async throws {
    let expiredURL = try XCTUnwrap(URL(string: "https://cdn.example.com/not-an-image"))
    let resolvedURL = try XCTUnwrap(URL(string: "https://cdn.example.com/still-not-an-image"))
    let recorder = ImageFetchRecorder()
    let loader = RecipeImageLoader(
      directImageFetcher: { url in
        await recorder.recordDirect(url)
        return Data("not an image".utf8)
      },
      imageURLResolver: {
        await recorder.recordResolution()
        return resolvedURL.absoluteString
      })

    let result = await loader.remoteImageData(imageURL: expiredURL.absoluteString)
    let directURLs = await recorder.directURLs
    let resolutionCalls = await recorder.resolutionCalls

    XCTAssertNil(result)
    XCTAssertEqual(directURLs, [expiredURL, resolvedURL])
    XCTAssertEqual(resolutionCalls, 1)
  }

  private static let validPNGData = Data(
    base64Encoded:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  )!
}

private actor ImageFetchRecorder {
  private(set) var directURLs: [URL] = []
  private(set) var resolutionCalls = 0

  func recordDirect(_ url: URL) { directURLs.append(url) }
  func recordResolution() { resolutionCalls += 1 }
}
