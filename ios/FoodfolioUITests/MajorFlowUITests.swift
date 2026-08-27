import XCTest

@MainActor final class MajorFlowUITests: XCTestCase {
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    return app
  }

  func testBrowseSearchAndOpenRecipeDetail() {
    let app = launch()
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
    app.buttons["home.search"].tap()
    app.textFields["search.query"].tap()
    app.textFields["search.query"].typeText("鶏もも肉")
    app.staticTexts["親子丼"].tap()
    XCTAssertTrue(app.staticTexts["detail.title"].exists)
    for _ in 0..<3 where !app.buttons["detail.addTag"].exists {
      app.swipeUp()
    }
    XCTAssertTrue(app.buttons["detail.addTag"].waitForExistence(timeout: 2))
    for _ in 0..<3 where !app.staticTexts["材料"].exists {
      app.swipeUp()
    }
    XCTAssertTrue(app.staticTexts["材料"].waitForExistence(timeout: 2))
  }

  func testDrawerContainsSettingsAndAccount() {
    let app = launch()
    app.buttons["home.drawer"].tap()
    XCTAssertTrue(app.buttons["drawer.settings"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["drawer.account"].exists)
    app.buttons["drawer.settings"].tap()
    XCTAssertTrue(app.switches["settings.analysisNotification"].waitForExistence(timeout: 3))
  }
}
