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
    let ingredientAmount = app.staticTexts["1/2個"]
    for _ in 0..<3 where !ingredientAmount.isHittable {
      app.swipeUp()
    }
    XCTAssertTrue(ingredientAmount.waitForExistence(timeout: 2))
    XCTAssertTrue(ingredientAmount.isHittable)
    XCTAssertFalse(app.staticTexts["0.5個"].exists)
  }

  func testRecipeDetailHeroAndCollapsingHeader() {
    let fullTitle = "親子丼 フライパンひとつで作れるとろとろ卵の簡単レシピ"
    let app = launch(arguments: ["-ui-testing-long-title"])
    XCTAssertTrue(app.staticTexts[fullTitle].waitForExistence(timeout: 5))
    app.staticTexts[fullTitle].tap()

    let hero = app.descendants(matching: .any)["detail.heroImage"]
    XCTAssertTrue(hero.waitForExistence(timeout: 3))
    XCTAssertEqual(hero.frame.width, app.frame.width, accuracy: 2)
    XCTAssertLessThanOrEqual(hero.frame.minY, app.frame.minY + 1)
    XCTAssertGreaterThanOrEqual(hero.frame.maxY, app.frame.width * 0.92)
    XCTAssertLessThanOrEqual(hero.frame.maxY, app.frame.width)

    let expandedTitle = app.staticTexts["detail.title"]
    let genreBadge = app.staticTexts["detail.genreBadge"]
    XCTAssertTrue(expandedTitle.exists)
    XCTAssertTrue(genreBadge.exists)
    XCTAssertEqual(genreBadge.label, "主菜")
    XCTAssertLessThan(genreBadge.frame.maxY, expandedTitle.frame.minY)
    XCTAssertFalse(app.staticTexts["ジャンル"].exists)
    XCTAssertEqual(expandedTitle.label, fullTitle)
    XCTAssertGreaterThan(expandedTitle.frame.height, 50)
    XCTAssertGreaterThanOrEqual(expandedTitle.frame.minY, hero.frame.maxY - 1)
    XCTAssertTrue(expandedTitle.isHittable)
    XCTAssertFalse(app.staticTexts["detail.compactTitle"].exists)

    let initialScreenshot = XCTAttachment(screenshot: app.screenshot())
    initialScreenshot.name = "Recipe detail hero"
    initialScreenshot.lifetime = .keepAlways
    add(initialScreenshot)

    for _ in 0..<4 where !app.staticTexts["detail.compactTitle"].exists {
      app.swipeUp()
    }

    let compactTitle = app.staticTexts["detail.compactTitle"]
    XCTAssertTrue(compactTitle.waitForExistence(timeout: 2))
    XCTAssertEqual(compactTitle.label, fullTitle)
    XCTAssertTrue(app.buttons["detail.edit"].exists)

    let collapsedScreenshot = XCTAttachment(screenshot: app.screenshot())
    collapsedScreenshot.name = "Recipe detail collapsed header"
    collapsedScreenshot.lifetime = .keepAlways
    add(collapsedScreenshot)
  }

  func testRecipeDetailShowsServingsAndStepperOnOneRow() {
    let app = launch()
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
    app.staticTexts["親子丼"].tap()

    let servings = app.staticTexts["detail.servingsValue"]
    let stepper = app.steppers["detail.servingsStepper"]
    XCTAssertTrue(servings.waitForExistence(timeout: 3))
    XCTAssertEqual(servings.label, "2人分")
    XCTAssertTrue(stepper.exists)
    XCTAssertEqual(servings.frame.midY, stepper.frame.midY, accuracy: 2)
    XCTAssertFalse(app.staticTexts["人数"].exists)
    XCTAssertFalse(app.staticTexts["表示人数: 2人"].exists)

    XCTAssertEqual(stepper.buttons.count, 2)
    stepper.buttons.element(boundBy: 1).tap()
    expectation(for: NSPredicate(format: "label == %@", "3人分"), evaluatedWith: servings)
    waitForExpectations(timeout: 2)
  }

  func testDrawerContainsSettingsAndAccount() {
    let app = launch()
    app.buttons["home.drawer"].tap()
    XCTAssertTrue(app.buttons["drawer.settings"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["drawer.account"].exists)
    app.buttons["drawer.settings"].tap()
    XCTAssertTrue(app.switches["settings.analysisNotification"].waitForExistence(timeout: 3))
  }

  func testBrandTitleIsBesideDrawerIcon() {
    let app = launch()
    let drawerIcon = app.buttons["home.drawer"]
    let brandTitle = app.staticTexts["home.brandTitle"]

    XCTAssertTrue(drawerIcon.waitForExistence(timeout: 3))
    XCTAssertTrue(brandTitle.waitForExistence(timeout: 3))
    XCTAssertEqual(brandTitle.label, "foodfolio")
    XCTAssertTrue(brandTitle.isHittable)
    XCTAssertGreaterThanOrEqual(brandTitle.frame.minX, drawerIcon.frame.maxX)
    XCTAssertLessThanOrEqual(brandTitle.frame.maxX, app.frame.maxX)
    XCTAssertGreaterThan(brandTitle.frame.width, 55)
    XCTAssertEqual(brandTitle.frame.midY, drawerIcon.frame.midY, accuracy: 2)
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
    let tagHeading = app.staticTexts["detail.tagHeading"]
    let createdTag = app.staticTexts["#新規タグ"]
    let addTagButton = app.buttons["detail.addTag"]
    XCTAssertTrue(createdTag.waitForExistence(timeout: 3))
    XCTAssertTrue(tagHeading.exists)
    XCTAssertTrue(addTagButton.exists)
    XCTAssertGreaterThan(createdTag.frame.minX, tagHeading.frame.maxX)
    XCTAssertGreaterThan(addTagButton.frame.minX, createdTag.frame.maxX)
    XCTAssertEqual(createdTag.frame.midY, tagHeading.frame.midY, accuracy: 3)
    XCTAssertEqual(addTagButton.frame.midY, createdTag.frame.midY, accuracy: 3)

    app.buttons["detail.edit"].tap()
    XCTAssertTrue(app.textFields["edit.title"].waitForExistence(timeout: 3))
    app.textFields["edit.title"].tap()
    app.textFields["edit.title"].typeText(" 更新")
    app.buttons["#新規タグ を外す"].tap()
    app.buttons["edit.save"].tap()
    XCTAssertTrue(app.staticTexts["追加したレシピ 更新"].waitForExistence(timeout: 3))

    for _ in 0..<4 where !app.buttons["detail.delete"].exists { app.swipeUp() }
    app.buttons["detail.delete"].tap()
    XCTAssertTrue(app.buttons["キャンセル"].waitForExistence(timeout: 2))
    app.buttons["キャンセル"].tap()
    XCTAssertTrue(app.staticTexts["追加したレシピ 更新"].exists)

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
