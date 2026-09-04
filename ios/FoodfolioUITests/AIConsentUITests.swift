import XCTest

@MainActor final class AIConsentUITests: FoodfolioUITestCase {
  func testDecliningConsentDoesNotSaveRecipe() {
    let app = launch()
    submitRecipe(app)
    XCTAssertTrue(app.staticTexts["aiConsent.title"].waitForExistence(timeout: 3))
    XCTAssertEqual(
      app.staticTexts["aiConsent.description"].label,
      "レシピの材料や作り方を整理するため、保存するページの文章・動画・タイトルなどを外部AIサービスへ送信します。"
    )
    XCTAssertFalse(
      app.staticTexts.matching(
        NSPredicate(
          format:
            "label CONTAINS %@ OR label CONTAINS %@ OR label CONTAINS %@ OR label CONTAINS %@",
          "Z.ai", "送信される場合があります", "保存済みレシピは閲覧できます", "取り消")
      ).firstMatch.exists)
    let policy = app.descendants(matching: .any).matching(identifier: "aiConsent.privacyPolicy")
      .firstMatch
    XCTAssertTrue(policy.exists)
    XCTAssertEqual(policy.label, "送信先・情報の取り扱いを確認")
    let decline = app.buttons["aiConsent.decline"]
    for _ in 0..<4 where !decline.isHittable { app.swipeUp() }
    decline.tap()
    XCTAssertTrue(app.textFields["add.url"].waitForExistence(timeout: 3))
    XCTAssertEqual(app.textFields["add.url"].value as? String, "https://example.com/new-recipe")
    app.buttons["キャンセル"].tap()
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 3))
    XCTAssertFalse(app.staticTexts["追加したレシピ"].exists)
  }

  func testConsentIsRememberedWithoutAnAISettingsSection() {
    let app = launch()
    assertSettingsDoNotExposeAIConsent(app)
    submitRecipe(app)
    let accept = app.buttons["aiConsent.accept"]
    XCTAssertTrue(accept.waitForExistence(timeout: 3))
    for _ in 0..<4 where !accept.isHittable { app.swipeUp() }
    accept.tap()
    XCTAssertTrue(app.staticTexts["追加したレシピ"].waitForExistence(timeout: 3))

    assertSettingsDoNotExposeAIConsent(app)
    submitRecipe(app)
    XCTAssertTrue(app.textFields["add.url"].waitForNonExistence(timeout: 3))
    XCTAssertFalse(app.staticTexts["aiConsent.title"].exists)
    XCTAssertTrue(app.buttons["home.add"].isHittable)
  }

  private func assertSettingsDoNotExposeAIConsent(_ app: XCUIApplication) {
    app.buttons["home.drawer"].tap()
    app.buttons["drawer.settings"].tap()
    XCTAssertTrue(app.navigationBars["設定"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.descendants(matching: .any)["settings.privacyPolicy"].exists)
    XCTAssertFalse(app.staticTexts["AI解析"].exists)
    XCTAssertFalse(app.buttons["settings.revokeAIConsent"].exists)
    XCTAssertFalse(app.staticTexts["settings.aiConsentNotGranted"].exists)
    app.navigationBars.buttons.firstMatch.tap()
    XCTAssertTrue(app.buttons["drawer.settings"].waitForExistence(timeout: 3))
    app.buttons["home.drawer"].tap()
    XCTAssertTrue(app.buttons["drawer.settings"].waitForNonExistence(timeout: 3))
  }

  private func submitRecipe(_ app: XCUIApplication) {
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 5))
    app.buttons["home.add"].tap()
    let url = app.textFields["add.url"]
    XCTAssertTrue(url.waitForExistence(timeout: 3))
    url.tap()
    url.typeText("https://example.com/new-recipe")
    app.buttons["add.save"].tap()
  }
}
