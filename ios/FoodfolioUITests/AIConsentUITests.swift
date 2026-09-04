import XCTest

@MainActor final class AIConsentUITests: FoodfolioUITestCase {
  func testConsentAppearsBeforeLoginAndDeclineKeepsAuthenticationBlocked() {
    let app = launch(arguments: ["-ui-testing-logged-out", "-ui-testing-ai-consent-required"])

    XCTAssertTrue(app.staticTexts["aiConsent.title"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["aiConsent.title"].label, "AI解析について")
    XCTAssertEqual(
      app.staticTexts["aiConsent.description"].label,
      "保存したレシピのURLやレシピ情報を外部AIサービスへ送信し、解析します。"
    )
    XCTAssertTrue(app.descendants(matching: .any)["aiConsent.privacyPolicy"].exists)
    XCTAssertFalse(app.buttons["auth.apple"].exists)
    XCTAssertFalse(app.buttons["auth.google"].exists)

    app.buttons["aiConsent.decline"].tap()
    let alert = app.alerts["同意しない場合"]
    XCTAssertTrue(alert.waitForExistence(timeout: 3))
    XCTAssertTrue(
      alert.staticTexts[
        "FoodfolioではAI解析が主要機能として使用されるため、同意いただけない場合はアプリをご利用いただけません。"
      ].exists)
    alert.buttons["OK"].tap()

    XCTAssertTrue(app.staticTexts["aiConsent.title"].exists)
    XCTAssertFalse(app.buttons["auth.google"].exists)
  }

  func testAcceptLoginRevokeAndReacceptFlow() {
    let app = launch(arguments: ["-ui-testing-logged-out", "-ui-testing-ai-consent-required"])

    let accept = app.buttons["aiConsent.accept"]
    XCTAssertTrue(accept.waitForExistence(timeout: 5))
    accept.tap()
    XCTAssertTrue(app.buttons["auth.google"].waitForExistence(timeout: 3))

    app.buttons["auth.google"].tap()
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 5))

    app.buttons["home.drawer"].tap()
    app.buttons["drawer.settings"].tap()
    XCTAssertTrue(app.navigationBars["設定"].waitForExistence(timeout: 3))
    XCTAssertEqual(app.staticTexts["settings.aiConsentStatus"].label, "同意済み")

    let revoke = app.buttons["settings.revokeAIConsent"]
    XCTAssertTrue(revoke.exists)
    revoke.tap()
    let alert = app.alerts["AI解析への同意を撤回しますか？"]
    XCTAssertTrue(alert.waitForExistence(timeout: 3))
    XCTAssertTrue(
      alert.staticTexts[
        "同意を撤回するとFoodfolioを利用できなくなります。再度同意するまでレシピの閲覧を含むアプリの機能は利用できません。"
      ].exists)
    alert.buttons["同意を撤回"].tap()

    XCTAssertTrue(app.staticTexts["aiConsent.title"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["home.add"].exists)

    app.buttons["aiConsent.accept"].tap()
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 5))
  }

  func testAuthenticatedRestoreHonorsServerRevocationInsteadOfRegranting() {
    let app = launch(arguments: ["-ui-testing-server-consent-revoked"])

    XCTAssertTrue(app.staticTexts["aiConsent.title"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["home.add"].exists)
    XCTAssertFalse(app.buttons["auth.google"].exists)
  }

  func testConsentSyncFailureClearsCachedRecipesBeforeReturningToLogin() {
    let app = launch(arguments: ["-ui-testing-ai-consent-sync-failure"])

    XCTAssertTrue(app.buttons["auth.google"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["親子丼"].exists)
    XCTAssertFalse(app.buttons["home.add"].exists)
  }
}
