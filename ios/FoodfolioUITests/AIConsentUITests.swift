import XCTest

@MainActor final class AIConsentUITests: FoodfolioUITestCase {
  func testDecliningConsentDoesNotSaveRecipe() {
    let app = launch()
    openConsent(app)
    XCTAssertTrue(app.staticTexts["aiConsent.title"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.descendants(matching: .any)["aiConsent.privacyPolicy"].exists)
    let decline = app.buttons["aiConsent.decline"]
    for _ in 0..<4 where !decline.isHittable { app.swipeUp() }
    decline.tap()
    XCTAssertTrue(app.textFields["add.url"].waitForExistence(timeout: 3))
    XCTAssertEqual(app.textFields["add.url"].value as? String, "https://example.com/new-recipe")
    app.buttons["キャンセル"].tap()
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 3))
    XCTAssertFalse(app.staticTexts["追加したレシピ"].exists)
  }

  func testConsentCanBeRevokedAndIsRequestedAgain() {
    let app = launch()
    openConsent(app)
    let accept = app.buttons["aiConsent.accept"]
    XCTAssertTrue(accept.waitForExistence(timeout: 3))
    for _ in 0..<4 where !accept.isHittable { app.swipeUp() }
    accept.tap()
    XCTAssertTrue(app.staticTexts["追加したレシピ"].waitForExistence(timeout: 3))

    app.buttons["home.drawer"].tap()
    app.buttons["drawer.settings"].tap()
    let revoke = app.buttons["settings.revokeAIConsent"]
    XCTAssertTrue(revoke.waitForExistence(timeout: 3))
    revoke.tap()
    XCTAssertTrue(app.staticTexts["settings.aiConsentNotGranted"].waitForExistence(timeout: 3))
    app.navigationBars.buttons.firstMatch.tap()
    openConsent(app)
    XCTAssertTrue(app.staticTexts["aiConsent.title"].waitForExistence(timeout: 3))
  }

  private func openConsent(_ app: XCUIApplication) {
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 5))
    app.buttons["home.add"].tap()
    let url = app.textFields["add.url"]
    XCTAssertTrue(url.waitForExistence(timeout: 3))
    url.tap()
    url.typeText("https://example.com/new-recipe")
    app.buttons["add.save"].tap()
  }
}
