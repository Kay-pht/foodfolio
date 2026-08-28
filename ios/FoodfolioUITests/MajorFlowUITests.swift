import XCTest

@MainActor final class MajorFlowUITests: XCTestCase {
  private func launch(arguments: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing"] + arguments
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

  func testLoggedOutAuthenticationAndPasswordReset() {
    let app = launch(arguments: ["-ui-testing-logged-out"])
    XCTAssertTrue(app.buttons["auth.google"].waitForExistence(timeout: 3))
    app.textFields["auth.email"].tap()
    app.textFields["auth.email"].typeText("ui@example.com")
    app.buttons["auth.resetPassword"].tap()
    XCTAssertTrue(app.staticTexts["リセットメールを送信しました。"].waitForExistence(timeout: 3))
    app.buttons["auth.google"].tap()
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 3))
  }

  func testAppleAuthenticationAdapter() {
    let app = launch(arguments: ["-ui-testing-logged-out"])
    XCTAssertTrue(app.buttons["auth.apple"].waitForExistence(timeout: 3))
    app.buttons["auth.apple"].tap()
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 3))
  }

  func testAddTagEditAndDeleteRecipe() {
    let app = launch()
    app.buttons["home.add"].tap()
    XCTAssertTrue(app.textFields["add.url"].waitForExistence(timeout: 3))
    app.textFields["add.url"].tap()
    app.textFields["add.url"].typeText("https://example.com/new-recipe")
    app.buttons["add.save"].tap()
    XCTAssertTrue(app.staticTexts["追加したレシピ"].waitForExistence(timeout: 3))
    app.staticTexts["追加したレシピ"].tap()

    for _ in 0..<3 where !app.buttons["detail.addTag"].exists { app.swipeUp() }
    app.buttons["detail.addTag"].tap()
    XCTAssertTrue(app.textFields["tag.name"].waitForExistence(timeout: 3))
    app.textFields["tag.name"].tap()
    app.textFields["tag.name"].typeText("新規タグ")
    app.buttons["tag.create"].tap()
    XCTAssertTrue(app.staticTexts["#新規タグ"].waitForExistence(timeout: 3))

    app.buttons["detail.edit"].tap()
    XCTAssertTrue(app.textFields["edit.title"].waitForExistence(timeout: 3))
    app.textFields["edit.title"].tap()
    app.textFields["edit.title"].typeText(" 更新")
    app.buttons["#新規タグ を外す"].tap()
    app.buttons["edit.save"].tap()
    XCTAssertTrue(app.staticTexts["追加したレシピ 更新"].waitForExistence(timeout: 3))

    for _ in 0..<4 where !app.buttons["detail.delete"].exists { app.swipeUp() }
    app.buttons["detail.delete"].tap()
    app.buttons["削除"].tap()
    XCTAssertFalse(app.staticTexts["追加したレシピ 更新"].waitForExistence(timeout: 2))
  }

  func testNotificationToggleAndLogout() {
    let app = launch()
    app.buttons["home.drawer"].tap()
    app.buttons["drawer.settings"].tap()
    let toggle = app.switches["settings.analysisNotification"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 3))
    expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: toggle)
    waitForExpectations(timeout: 3)
    XCTAssertEqual(toggle.value as? String, "オン")
    toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
    expectation(for: NSPredicate(format: "value != %@", "オン"), evaluatedWith: toggle)
    waitForExpectations(timeout: 3)

    app.terminate()
    app.launch()
    app.buttons["home.drawer"].tap()
    app.buttons["drawer.account"].tap()
    XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 3))
    app.buttons["account.logout"].tap()
    XCTAssertTrue(app.buttons["auth.google"].waitForExistence(timeout: 3))
  }
}
