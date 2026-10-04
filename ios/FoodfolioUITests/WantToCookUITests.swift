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
    let memo = "味が少し濃かった。\n次回は醤油を少なめにする。\n火を弱める。\n最後に味見する。"
    editor.typeText(memo)
    app.buttons["memo.save"].tap()

    let preview = app.staticTexts["detail.memoPreviewText"]
    XCTAssertTrue(preview.waitForExistence(timeout: 3))
    XCTAssertEqual(preview.label, memo)
    XCTAssertTrue(app.staticTexts["detail.memoPreviewHeading"].exists)
    XCTAssertFalse(app.buttons["detail.memoShortcut"].exists)

    let openMemo = app.buttons["detail.memoPreviewOpen"]
    XCTAssertTrue(openMemo.waitForExistence(timeout: 2))
    openMemo.tap()

    let content = app.staticTexts["memo.content"]
    XCTAssertTrue(content.waitForExistence(timeout: 3))
    XCTAssertEqual(content.label, memo)
    XCTAssertTrue(app.buttons["memo.edit"].exists)
  }

  func testExistingMemoIsImmediatelyVisibleAndEditableFromMenu() {
    let app = launch(arguments: ["-ui-testing-existing-memo"])
    openSeedRecipe(in: app)

    XCTAssertTrue(app.staticTexts["detail.memoPreviewHeading"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["detail.memoPreviewText"].exists)
    XCTAssertFalse(app.buttons["detail.memoShortcut"].exists)

    let openMemo = app.buttons["detail.memoPreviewOpen"]
    XCTAssertTrue(openMemo.waitForNonExistence(timeout: 2))

    openRecipeMenu(in: app)
    let editMemo = app.buttons["detail.memoMenu"]
    XCTAssertTrue(editMemo.waitForExistence(timeout: 2))
    editMemo.tap()
    let editor = app.textViews["memo.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 2))
    XCTAssertEqual(editor.value as? String, "味が少し濃かった。\n次回は醤油を少なめにする。")
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

  func testThreeLinesHaveNoFullTextActionAndEditsRecomputeTruncation() {
    let app = launch(arguments: ["-ui-testing-existing-memo"])
    openSeedRecipe(in: app)
    saveMemo("一行目\n二行目\n三行目", in: app)
    let openMemo = app.buttons["detail.memoPreviewOpen"]
    XCTAssertTrue(openMemo.waitForNonExistence(timeout: 2))

    saveMemo("一行目\n二行目\n三行目\n四行目", in: app)
    XCTAssertTrue(openMemo.waitForExistence(timeout: 3))
    openMemo.tap()
    XCTAssertEqual(app.staticTexts["memo.content"].label, "一行目\n二行目\n三行目\n四行目")
    app.buttons["memo.cancel"].tap()

    saveMemo("短いメモ", in: app)
    XCTAssertTrue(openMemo.waitForNonExistence(timeout: 3))
    XCTAssertEqual(app.staticTexts["detail.memoPreviewText"].label, "短いメモ")
    XCTAssertEqual(app.staticTexts.matching(identifier: "detail.memoPreviewText").count, 1)
    saveMemo("", in: app)
    XCTAssertTrue(app.staticTexts["detail.memoPreviewHeading"].waitForNonExistence(timeout: 3))
  }

  func testLongMemoWithoutNewlinesRecomputesTruncationWhenWidthChanges() {
    let app = launch(arguments: ["-ui-testing-existing-memo"])
    openSeedRecipe(in: app)
    let memo = String(repeating: "次回は調味料を少なめにして最後に味見をする。", count: 4)
    saveMemo(memo, in: app)
    let openMemo = app.buttons["detail.memoPreviewOpen"]
    XCTAssertTrue(openMemo.waitForExistence(timeout: 3))
    openMemo.tap()
    XCTAssertEqual(app.staticTexts["memo.content"].label, memo)
    app.buttons["memo.cancel"].tap()

    defer { XCUIDevice.shared.orientation = .portrait }
    XCUIDevice.shared.orientation = .landscapeLeft
    let preview = app.staticTexts["detail.memoPreviewText"]
    let lower = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
    let upper = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    for _ in 0..<12 where !preview.isHittable {
      lower.press(forDuration: 0.05, thenDragTo: upper)
    }
    XCTAssertTrue(preview.isHittable)
    XCTAssertGreaterThan(max(preview.frame.width, preview.frame.height), 500)
    XCTAssertTrue(openMemo.waitForNonExistence(timeout: 3))
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(openMemo.waitForExistence(timeout: 3))
  }

  func testMemoTruncationUsesDynamicTypeSize() {
    let app = launch(
      arguments: [
        "-ui-testing-existing-memo",
        "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
      ])
    openSeedRecipe(in: app)
    let preview = app.staticTexts["detail.memoPreviewText"]
    for _ in 0..<5 where !preview.isHittable { app.swipeUp() }
    XCTAssertTrue(preview.exists)
    XCTAssertTrue(app.buttons["detail.memoPreviewOpen"].waitForExistence(timeout: 3))
  }

  func testMemoSaveButtonKeepsSizeAndDraftAfterFailure() {
    let app = launch(arguments: ["-ui-testing-memo-save-failure"])
    openSeedRecipe(in: app)
    openRecipeMenu(in: app)
    app.buttons["detail.memoMenu"].tap()
    let editor = app.textViews["memo.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 3))
    editor.tap()
    editor.typeText("次回は醤油を減らす。")
    let save = app.buttons["memo.save"]
    let idleFrame = save.frame
    save.tap()
    expectation(for: NSPredicate(format: "enabled == false"), evaluatedWith: save)
    waitForExpectations(timeout: 3)
    XCTAssertEqual(save.frame.width, idleFrame.width, accuracy: 1)
    XCTAssertEqual(save.frame.height, idleFrame.height, accuracy: 1)
    XCTAssertFalse(app.buttons["memo.cancel"].isEnabled)
    let savingScreenshot = XCTAttachment(screenshot: app.screenshot())
    savingScreenshot.name = "memo-saving"
    savingScreenshot.lifetime = .keepAlways
    add(savingScreenshot)
    expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: save)
    waitForExpectations(timeout: 12)
    XCTAssertEqual(editor.value as? String, "次回は醤油を減らす。")
    XCTAssertTrue(app.buttons["memo.cancel"].isEnabled)
    XCTAssertEqual(save.frame.width, idleFrame.width, accuracy: 1)
    XCTAssertEqual(save.frame.height, idleFrame.height, accuracy: 1)
    app.buttons["memo.cancel"].tap()
    XCTAssertTrue(editor.waitForNonExistence(timeout: 3))
    XCTAssertFalse(app.staticTexts["detail.memoPreviewText"].exists)
  }

  func testMemoEditorStartsCompactAndEnforces200CharacterLimit() {
    let app = launch()
    openSeedRecipe(in: app)
    openRecipeMenu(in: app)
    app.buttons["detail.memoMenu"].tap()
    let editor = app.textViews["memo.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 3))
    XCTAssertGreaterThan(editor.frame.minY, app.frame.height * 0.4)
    XCTAssertLessThan(editor.frame.height, 210)
    let compactScreenshot = XCTAttachment(screenshot: app.screenshot())
    compactScreenshot.name = "memo-compact"
    compactScreenshot.lifetime = .keepAlways
    add(compactScreenshot)
    let grabber = app.buttons["シートグラバー"]
    XCTAssertTrue(grabber.exists)
    grabber.swipeUp()
    XCTAssertLessThan(editor.frame.minY, app.frame.height * 0.4)
    XCUIDevice.shared.orientation = .landscapeLeft
    XCTAssertTrue(editor.isHittable)
    XCTAssertTrue(app.buttons["memo.save"].isHittable)
    XCTAssertTrue(app.buttons["memo.cancel"].isHittable)
    XCUIDevice.shared.orientation = .portrait
    editor.tap()
    editor.typeText(String(repeating: "a", count: 201))
    let save = app.buttons["memo.save"]
    XCTAssertEqual(app.staticTexts["memo.characterCount"].label, "201/200")
    XCTAssertFalse(save.isEnabled)
    editor.typeText(XCUIKeyboardKey.delete.rawValue)
    XCTAssertEqual(app.staticTexts["memo.characterCount"].label, "200/200")
    XCTAssertTrue(save.isEnabled)
    save.tap()
    XCTAssertTrue(editor.waitForNonExistence(timeout: 3))
    XCTAssertEqual(
      app.staticTexts["detail.memoPreviewText"].label, String(repeating: "a", count: 200))
  }

  private func saveMemo(_ text: String, in app: XCUIApplication) {
    openRecipeMenu(in: app)
    app.buttons["detail.memoMenu"].tap()
    let editor = app.textViews["memo.editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 3))
    editor.tap()
    let existing = editor.value as? String ?? ""
    for _ in 0..<existing.count {
      editor.typeKey(XCUIKeyboardKey.rightArrow.rawValue, modifierFlags: [])
    }
    editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
    if !text.isEmpty { editor.typeText(text) }
    app.buttons["memo.save"].tap()
    XCTAssertTrue(editor.waitForNonExistence(timeout: 3))
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
