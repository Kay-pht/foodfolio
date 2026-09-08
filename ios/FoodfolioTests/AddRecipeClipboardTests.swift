import XCTest

@testable import Foodfolio

@MainActor final class AddRecipeClipboardTests: XCTestCase {
  func testPastedTextExtractsFirstHTTPURL() {
    let model = AddRecipeViewModel()

    let result = model.usePastedText(
      "このレシピを見てください https://example.com/recipes/123?source=share"
    )

    XCTAssertTrue(result)
    XCTAssertEqual(model.url, "https://example.com/recipes/123?source=share")
    XCTAssertNil(model.errorMessage)
  }

  func testPastedTextRejectsTextWithoutHTTPURL() {
    let model = AddRecipeViewModel()
    model.url = "https://example.com/old"

    let result = model.usePastedText("レシピ名だけがコピーされています")

    XCTAssertFalse(result)
    XCTAssertEqual(model.url, "")
    XCTAssertEqual(model.errorMessage, APIError.invalidURL.userMessage)
  }
}
