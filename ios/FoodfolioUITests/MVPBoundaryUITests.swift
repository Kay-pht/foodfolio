import XCTest

@MainActor final class MVPBoundaryUITests: FoodfolioUITestCase {
  func testRecipeGridAlignsImagesWhenTitlesUseDifferentLineCounts() {
    let longTitle = "キャベツステーキ 簡単レシピ！シンプルだけど香ばしい"
    let app = launch(arguments: ["-ui-testing-mixed-title-grid"])
    let shortTitle = app.staticTexts["親子丼"]
    let longTitleElement = app.staticTexts[longTitle]

    XCTAssertTrue(shortTitle.waitForExistence(timeout: 5))
    XCTAssertTrue(longTitleElement.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(longTitleElement.frame.height, shortTitle.frame.height)
    XCTAssertEqual(shortTitle.frame.minY, longTitleElement.frame.minY, accuracy: 2)
  }

  func testNotRecipeRemainsVisibleCannotBeEditedAndKeepsSourceAndDeleteActions() {
    let app = launch(arguments: ["-ui-testing-status-not-recipe"])
    let message = app.staticTexts["レシピとして判定できませんでした"]
    XCTAssertTrue(message.waitForExistence(timeout: 5))
    message.tap()
    XCTAssertTrue(app.staticTexts["detail.title"].waitForExistence(timeout: 3))
    XCTAssertEqual(app.staticTexts["detail.title"].label, "レシピとして判定できませんでした")
    XCTAssertTrue(app.descendants(matching: .any)["detail.source"].exists)
    XCTAssertTrue(app.buttons["detail.delete"].exists)
    XCTAssertTrue(app.buttons["detail.moreMenu"].exists)
    app.buttons["detail.moreMenu"].tap()
    XCTAssertFalse(app.buttons["detail.edit"].exists)
  }

  func testFailedRecipeRemainsVisibleShowsFailureAndCanBeEdited() {
    let app = launch(arguments: ["-ui-testing-status-failed"])
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
    app.staticTexts["親子丼"].tap()
    XCTAssertTrue(app.staticTexts["detail.title"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["レシピの解析に問題がありました。"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["detail.moreMenu"].exists)
    app.buttons["detail.moreMenu"].tap()
    XCTAssertTrue(app.buttons["detail.edit"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["親子丼"].exists)
  }
}
