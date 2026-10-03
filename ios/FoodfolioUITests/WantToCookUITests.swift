import XCTest

@MainActor final class WantToCookUITests: FoodfolioUITestCase {
  private let seedTitle = "親子丼"
  private let otherTitle = "キャベツステーキ 簡単レシピ！シンプルだけど香ばしい"

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
    let markedTitle = app.staticTexts[seedTitle]
    let normalTitle = app.staticTexts[otherTitle]
    XCTAssertTrue(wantHeading.waitForExistence(timeout: 3))
    XCTAssertTrue(otherHeading.waitForExistence(timeout: 3))
    XCTAssertTrue(markedTitle.waitForExistence(timeout: 3))
    XCTAssertTrue(normalTitle.waitForExistence(timeout: 3))
    XCTAssertEqual(textCount(seedTitle, in: app), 1)
    XCTAssertLessThan(wantHeading.frame.minY, markedTitle.frame.minY)
    XCTAssertLessThan(markedTitle.frame.minY, otherHeading.frame.minY)
    XCTAssertLessThan(otherHeading.frame.minY, normalTitle.frame.minY)

    markedTitle.tap()
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
    XCTAssertTrue(app.staticTexts[seedTitle].waitForExistence(timeout: 3))
    XCTAssertEqual(textCount(seedTitle, in: app), 1)
  }

  func testMemoCanBeAddedAndOpenedFromDetailPreview() {
    let app = launch()
    openSeedRecipe(in: app)
    XCTAssertFalse(app.staticTexts["detail.memoPreviewText"].exists)
    XCTAssertFalse(app.buttons["detail.memoPreviewOpen"].exists)
    XCTAssertFalse(app.buttons["detail.memoShortcut"].exists)

    openRecipeMenu(in: app)
    let memoMenu = app.buttons["detail.memoMenu"]
    XCTAssertTrue(memoMenu.waitForExistence(timeout: 2))
    memoMenu.tap()

    let editor = app.textViews["memo.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 3))
    editor.tap()
    editor.typeText("味が少し濃かった。\n次回は醤油を少なめにする。")
    app.buttons["memo.save"].tap()

    let preview = app.staticTexts["detail.memoPreviewText"]
    XCTAssertTrue(preview.waitForExistence(timeout: 3))
    XCTAssertEqual(preview.label, "味が少し濃かった。\n次回は醤油を少なめにする。")
    XCTAssertTrue(app.staticTexts["detail.memoPreviewHeading"].exists)
    XCTAssertFalse(app.buttons["detail.memoShortcut"].exists)

    let openMemo = app.buttons["detail.memoPreviewOpen"]
    XCTAssertTrue(openMemo.waitForExistence(timeout: 2))
    openMemo.tap()

    let content = app.staticTexts["memo.content"]
    XCTAssertTrue(content.waitForExistence(timeout: 3))
    XCTAssertEqual(content.label, "味が少し濃かった。\n次回は醤油を少なめにする。")
    XCTAssertTrue(app.buttons["memo.edit"].exists)
  }

  func testExistingMemoIsImmediatelyVisibleAndEditableFromMenu() {
    let app = launch(arguments: ["-ui-testing-existing-memo"])
    openSeedRecipe(in: app)

    XCTAssertTrue(app.staticTexts["detail.memoPreviewHeading"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["detail.memoPreviewText"].exists)
    XCTAssertFalse(app.buttons["detail.memoShortcut"].exists)

    let openMemo = app.buttons["detail.memoPreviewOpen"]
    XCTAssertTrue(openMemo.waitForExistence(timeout: 2))
    openMemo.tap()
    XCTAssertTrue(app.staticTexts["memo.content"].waitForExistence(timeout: 2))
    app.buttons["memo.cancel"].tap()

    openRecipeMenu(in: app)
    XCTAssertTrue(app.buttons["detail.memoMenu"].waitForExistence(timeout: 2))
  }

  func testMemoMenuMatchesOrdinaryRecipeEditability() {
    assertMemoMenuAvailability(
      statusArgument: "-ui-testing-status-pending", title: seedTitle, expected: false)
    assertMemoMenuAvailability(
      statusArgument: "-ui-testing-status-processing", title: seedTitle, expected: false)
    assertMemoMenuAvailability(
      statusArgument: "-ui-testing-status-not-recipe",
      title: "レシピとして判定できませんでした", expected: false)
    assertMemoMenuAvailability(
      statusArgument: "-ui-testing-status-failed", title: seedTitle, expected: true)
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

  private func assertMemoMenuAvailability(
    statusArgument: String, title: String, expected: Bool
  ) {
    let app = launch(arguments: [statusArgument])
    let recipeTitle = app.staticTexts[title]
    XCTAssertTrue(recipeTitle.waitForExistence(timeout: 5))
    recipeTitle.tap()
    XCTAssertTrue(app.staticTexts["detail.title"].waitForExistence(timeout: 3))
    openRecipeMenu(in: app)

    let memoMenu = app.buttons["detail.memoMenu"]
    if expected {
      XCTAssertTrue(memoMenu.waitForExistence(timeout: 2))
    } else {
      XCTAssertFalse(memoMenu.exists)
    }
    app.terminate()
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
    let title = app.staticTexts[seedTitle]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    XCTAssertTrue(app.staticTexts["detail.title"].waitForExistence(timeout: 3))
  }

  private func openRecipeMenu(in app: XCUIApplication) {
    let menu = app.buttons["detail.moreMenu"]
    XCTAssertTrue(menu.waitForExistence(timeout: 3))
    menu.tap()
  }

  private func returnToHome(in app: XCUIApplication) {
    let navigationBar = app.navigationBars.firstMatch
    XCTAssertTrue(navigationBar.waitForExistence(timeout: 3))
    let backButtons = navigationBar.buttons.allElementsBoundByIndex.filter {
      $0.identifier != "detail.moreMenu"
    }
    XCTAssertFalse(backButtons.isEmpty)
    backButtons[0].tap()
    XCTAssertTrue(app.buttons["home.search"].waitForExistence(timeout: 3))
  }

  private func textCount(_ label: String, in app: XCUIApplication) -> Int {
    app.staticTexts.allElementsBoundByIndex.filter { $0.label == label }.count
  }
}
