import XCTest

@MainActor final class WantToCookUITests: FoodfolioUITestCase {
  func testWantToCookMovesRecipeIntoDedicatedHomeSectionAndCanBeRemoved() {
    let app = launch(arguments: ["-ui-testing-mixed-title-grid"])
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
    app.staticTexts["親子丼"].tap()

    openRecipeMenu(in: app)
    let wantToCook = app.buttons["detail.wantToCook"]
    XCTAssertTrue(wantToCook.waitForExistence(timeout: 2))
    wantToCook.tap()
    XCTAssertTrue(app.staticTexts["detail.wantToCookStatus"].waitForExistence(timeout: 3))

    app.navigationBars.buttons.firstMatch.tap()

    let wantHeading = app.staticTexts["home.wantToCookHeading"]
    let otherHeading = app.staticTexts["home.otherRecipesHeading"]
    let markedCard = app.descendants(matching: .any)["recipe.card.ui-recipe"]
    let otherCard = app.descendants(matching: .any)["recipe.card.ui-recipe-long"]
    XCTAssertTrue(wantHeading.waitForExistence(timeout: 3))
    XCTAssertTrue(otherHeading.exists)
    XCTAssertTrue(markedCard.exists)
    XCTAssertTrue(otherCard.exists)
    XCTAssertEqual(
      app.descendants(matching: .any).matching(identifier: "recipe.card.ui-recipe").count, 1)
    XCTAssertGreaterThan(markedCard.frame.minY, wantHeading.frame.maxY)
    XCTAssertLessThan(markedCard.frame.maxY, otherHeading.frame.minY)
    XCTAssertGreaterThan(otherCard.frame.minY, otherHeading.frame.maxY)

    markedCard.tap()
    XCTAssertTrue(app.staticTexts["detail.wantToCookStatus"].waitForExistence(timeout: 3))
    openRecipeMenu(in: app)
    let removeWantToCook = app.buttons["detail.wantToCook"]
    XCTAssertTrue(removeWantToCook.waitForExistence(timeout: 2))
    removeWantToCook.tap()
    expectation(
      for: NSPredicate(format: "exists == false"),
      evaluatedWith: app.staticTexts["detail.wantToCookStatus"])
    waitForExpectations(timeout: 3)

    app.navigationBars.buttons.firstMatch.tap()
    XCTAssertFalse(wantHeading.waitForExistence(timeout: 1))
    XCTAssertFalse(otherHeading.exists)
    XCTAssertEqual(
      app.descendants(matching: .any).matching(identifier: "recipe.card.ui-recipe").count, 1)
  }

  func testWantToCookRemainsAvailableWhileAnalysisIsPendingOrProcessing() {
    for statusArgument in ["-ui-testing-status-pending", "-ui-testing-status-processing"] {
      let app = launch(arguments: [statusArgument])
      XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
      app.staticTexts["親子丼"].tap()

      openRecipeMenu(in: app)
      let wantToCook = app.buttons["detail.wantToCook"]
      XCTAssertTrue(wantToCook.waitForExistence(timeout: 2))
      XCTAssertTrue(wantToCook.isEnabled)
      XCTAssertFalse(app.buttons["detail.edit"].exists)
      wantToCook.tap()
      XCTAssertTrue(app.staticTexts["detail.wantToCookStatus"].waitForExistence(timeout: 3))

      app.terminate()
    }
  }

  func testWantToCookFailureShowsUserMessageAndDoesNotUpdateLocalState() {
    let app = launch(arguments: ["-ui-testing-want-to-cook-failure"])
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
    app.staticTexts["親子丼"].tap()
    XCTAssertFalse(app.staticTexts["detail.wantToCookStatus"].exists)

    openRecipeMenu(in: app)
    let wantToCook = app.buttons["detail.wantToCook"]
    XCTAssertTrue(wantToCook.waitForExistence(timeout: 2))
    wantToCook.tap()

    let alert = app.alerts["エラー"]
    XCTAssertTrue(alert.waitForExistence(timeout: 3))
    XCTAssertTrue(alert.staticTexts["通信に失敗しました。もう一度お試しください。"].exists)
    XCTAssertFalse(app.staticTexts["detail.wantToCookStatus"].exists)
    alert.buttons["OK"].tap()

    app.navigationBars.buttons.firstMatch.tap()
    XCTAssertFalse(app.staticTexts["home.wantToCookHeading"].exists)
  }

  private func openRecipeMenu(in app: XCUIApplication) {
    let menu = app.buttons["detail.moreMenu"]
    XCTAssertTrue(menu.waitForExistence(timeout: 3))
    menu.tap()
  }
}
