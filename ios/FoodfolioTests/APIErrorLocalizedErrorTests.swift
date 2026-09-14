import XCTest

@testable import Foodfolio

final class APIErrorLocalizedErrorTests: XCTestCase {
  func testLocalizedDescriptionUsesUserFacingMessage() {
    XCTAssertEqual(
      APIError.notFound.localizedDescription,
      "対象が見つかりませんでした。")
    XCTAssertEqual(
      APIError.server.localizedDescription,
      "通信に失敗しました。もう一度お試しください。")
  }
}
