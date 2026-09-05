import Foundation
import XCTest

@testable import Foodfolio

final class SharedURLParserTests: XCTestCase {
  func testExtractsFirstHTTPURLFromText() {
    let result = SharedURLParser.firstHTTPURL(
      in: "この動画をチェック！ https://www.tiktok.com/@example/video/123 次はこちら https://example.com")

    XCTAssertEqual(result?.absoluteString, "https://www.tiktok.com/@example/video/123")
  }

  func testRejectsNonHTTPURL() {
    XCTAssertNil(SharedURLParser.firstHTTPURL(in: "mailto:test@example.com"))
    XCTAssertFalse(SharedURLParser.isHTTPURL(URL(string: "foodfolio://recipe/1")!))
  }

  func testAcceptsHTTPAndHTTPS() {
    XCTAssertTrue(SharedURLParser.isHTTPURL(URL(string: "http://example.com")!))
    XCTAssertTrue(SharedURLParser.isHTTPURL(URL(string: "https://example.com")!))
  }
}
