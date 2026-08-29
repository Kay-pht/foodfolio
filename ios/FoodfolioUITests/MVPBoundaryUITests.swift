import XCTest

@MainActor final class MVPBoundaryUITests: XCTestCase {
  private func launch(arguments: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing"] + arguments
    app.launch()
    return app
  }

  private func openRecipe(_ app: XCUIApplication) {
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
    app.staticTexts["親子丼"].tap()
    XCTAssertTrue(app.staticTexts["detail.title"].waitForExistence(timeout: 3))
  }

  func testServingsControlsAreHiddenWhenBaseServingsAreUnavailable() {
    let app = launch(arguments: ["-ui-testing-no-servings"])
    openRecipe(app)
    XCTAssertFalse(app.buttons["detail.servingsMinus"].exists)
    XCTAssertFalse(app.buttons["detail.servingsPlus"].exists)
    XCTAssertFalse(app.staticTexts["detail.servingsValue"].exists)
  }

  func testRangeServingsShowRawTextWithoutScalingControls() {
    let app = launch(arguments: ["-ui-testing-range-servings"])
    openRecipe(app)
    let value = app.staticTexts["detail.servingsValue"]
    XCTAssertTrue(value.waitForExistence(timeout: 2))
    XCTAssertEqual(value.label, "1〜2人分")
    XCTAssertFalse(app.buttons["detail.servingsMinus"].exists)
    XCTAssertFalse(app.buttons["detail.servingsPlus"].exists)
  }

  func testServingsControlsEnforceOneAndTwentyPersonBoundaries() {
    let one = launch(arguments: ["-ui-testing-one-serving"])
    openRecipe(one)
    XCTAssertFalse(one.buttons["detail.servingsMinus"].isEnabled)
    one.terminate()

    let twenty = launch(arguments: ["-ui-testing-twenty-servings"])
    openRecipe(twenty)
    XCTAssertFalse(twenty.buttons["detail.servingsPlus"].isEnabled)
  }

  func testServingsScalingPreservesNonNumericAmountsAndResetsWhenDetailReopens() {
    let app = launch()
    openRecipe(app)
    let value = app.staticTexts["detail.servingsValue"]
    XCTAssertEqual(value.label, "2 servings")
    app.buttons["detail.servingsPlus"].tap()
    expectation(for: NSPredicate(format: "label == %@", "3人分"), evaluatedWith: value)
    waitForExpectations(timeout: 2)
    XCTAssertTrue(app.staticTexts["少々"].exists)

    app.navigationBars.buttons.firstMatch.tap()
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 3))
    app.staticTexts["親子丼"].tap()
    XCTAssertEqual(app.staticTexts["detail.servingsValue"].label, "2 servings")
  }

  func testPendingAndProcessingRecipesCannotBeEdited() {
    for argument in ["-ui-testing-status-pending", "-ui-testing-status-processing"] {
      let app = launch(arguments: [argument])
      openRecipe(app)
      XCTAssertFalse(app.buttons["detail.edit"].exists)
      app.terminate()
    }
  }

  func testFailedRecipeRemainsVisibleShowsFailureAndCanBeEdited() {
    let app = launch(arguments: ["-ui-testing-status-failed"])
    openRecipe(app)
    XCTAssertTrue(app.staticTexts["レシピの解析に問題がありました。"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["detail.edit"].exists)
    XCTAssertTrue(app.staticTexts["親子丼"].exists)
  }
}
