import XCTest

@MainActor final class WantToCookUITests: FoodfolioUITestCase {
  func testWantToCookMovesRecipeIntoDedicatedHomeSectionAndCanBeRemoved() {
    let app = launch(arguments: ["-ui-testing-mixed-title-grid"])
    openSeedRecipe(in: app)

    openRecipeMenu(in: app)
    let wantToCook = app.buttons["detail.wantToCook"]
    XCTAssertTrue(wantToCook.waitForExistence(timeout: 2))
    wantToCook.tap()
    XCTAssertTrue(app.staticTexts["detail.wantToCookStatus"].waitForExistence(timeout: 3))

    returnToHome(in: app)

    let wantHeading = app.staticTexts["home.wantToCookHeading"]
    let otherHeading = app.staticTexts["home.otherRecipesHeading"]
    let markedCard = recipeCard(id: "ui-recipe", in: app)
    let otherCard = recipeCard(id: "ui-recipe-long", in: app)
    XCTAssertTrue(wantHeading.waitForExistence(timeout: 3))
    XCTAssertTrue(otherHeading.waitForExistence(timeout: 3))
    XCTAssertTrue(markedCard.waitForExistence(timeout: 3))
    XCTAssertTrue(otherCard.waitForExistence(timeout: 3))
    XCTAssertEqual(
      app.descendants(matching: .any).matching(identifier: "recipe.card.ui-recipe").count, 1)
    XCTAssertLessThan(wantHeading.frame.minY, markedCard.frame.minY)
    XCTAssertLessThan(markedCard.frame.minY, otherHeading.frame.minY)
    XCTAssertLessThan(otherHeading.frame.minY, otherCard.frame.minY)

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

    returnToHome(in: app)
    XCTAssertFalse(wantHeading.waitForExistence(timeout: 1))
    XCTAssertFalse(otherHeading.exists)
    XCTAssertTrue(recipeCard(id: "ui-recipe", in: app).waitForExistence(timeout: 3))
    XCTAssertEqual(
      app.descendants(matching: .any).matching(identifier: "recipe.card.ui-recipe").count, 1)
  }

  func testWantToCookRemainsAvailableWhileAnalysisIsPending() {
    assertWantToCookAvailableWhileAnalyzing(statusArgument: "-ui-testing-status-pending")
  }

  func testWantToCookRemainsAvailableWhileAnalysisIsProcessing() {
    assertWantToCookAvailableWhileAnalyzing(statusArgument: "-ui-testing-status-processing")
  }

  func testWantToCookFailureShowsUserMessageAndDoesNotUpdateLocalState() {
    let app = launch(arguments: ["-ui-testing-want-to-cook-failure"])
    openSeedRecipe(in: app)
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

    returnToHome(in: app)
    XCTAssertFalse(app.staticTexts["home.wantToCookHeading"].exists)
  }

  private func assertWantToCookAvailableWhileAnalyzing(statusArgument: String) {
    let app = launch(arguments: [statusArgument])
    openSeedRecipe(in: app)

    openRecipeMenu(in: app)
    let wantToCook = app.buttons["detail.wantToCook"]
    XCTAssertTrue(wantToCook.waitForExistence(timeout: 2))
    XCTAssertTrue(wantToCook.isEnabled)
    XCTAssertFalse(app.buttons["detail.edit"].exists)
    wantToCook.tap()
    XCTAssertTrue(app.staticTexts["detail.wantToCookStatus"].waitForExistence(timeout: 3))
  }

  private func openSeedRecipe(in app: XCUIApplication) {
    let card = recipeCard(id: "ui-recipe", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    XCTAssertTrue(app.staticTexts["detail.title"].waitForExistence(timeout: 3))
  }

  private func recipeCard(id: String, in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any)["recipe.card.\(id)"]
  }

  private func openRecipeMenu(in app: XCUIApplication) {
    let menu = app.buttons["detail.moreMenu"]
    XCTAssertTrue(menu.waitForExistence(timeout: 3))
    menu.tap()
  }

  private func returnToHome(in app: XCUIApplication) {
    let navigationBar = app.navigationBars.firstMatch
    XCTAssertTrue(navigationBar.waitForExistence(timeout: 3))
    let backButton = navigationBar.buttons.matching(
      NSPredicate(format: "identifier != %@", "detail.moreMenu")
    ).firstMatch
    XCTAssertTrue(backButton.waitForExistence(timeout: 3))
    backButton.tap()
    XCTAssertTrue(app.buttons["home.search"].waitForExistence(timeout: 3))
  }
}
