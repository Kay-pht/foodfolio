import XCTest

@MainActor class FoodfolioUITestCase: XCTestCase {
  func launch(arguments: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.terminate()
    app.launchArguments = ["-ui-testing"] + arguments
    app.launch()
    return app
  }
}

@MainActor final class RecipeDiscoveryUITests: FoodfolioUITestCase {
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

  func testSearchGenreAndTagUseAnchoredMenus() {
    let app = launch()
    XCTAssertTrue(app.buttons["home.search"].waitForExistence(timeout: 5))
    app.buttons["home.search"].tap()

    let genreButton = app.buttons["search.genre"]
    XCTAssertTrue(genreButton.waitForExistence(timeout: 3))
    genreButton.tap()
    let mainOption = app.buttons["search.genre.option.主菜"]
    XCTAssertTrue(mainOption.waitForExistence(timeout: 3))
    XCTAssertFalse(app.pickerWheels.firstMatch.exists)
    mainOption.tap()
    XCTAssertEqual(genreButton.label, "主菜")

    let tagButton = app.buttons["search.tag"]
    tagButton.tap()
    let easyOption = app.buttons["search.tag.option.簡単"]
    XCTAssertTrue(easyOption.waitForExistence(timeout: 3))
    easyOption.tap()
    XCTAssertEqual(tagButton.label, "簡単")
  }

  func testRecipeDetailUsesCompactTitleAndContentLayout() {
    let fullTitle = "親子丼 フライパンひとつで作れるとろとろ卵の簡単レシピ"
    let app = launch(arguments: ["-ui-testing-long-title"])
    XCTAssertTrue(app.staticTexts[fullTitle].waitForExistence(timeout: 5))
    app.staticTexts[fullTitle].tap()

    let hero = app.descendants(matching: .any)["detail.heroImage"]
    XCTAssertTrue(hero.waitForExistence(timeout: 3))
    XCTAssertEqual(hero.frame.width, app.frame.width, accuracy: 2)
    XCTAssertGreaterThanOrEqual(hero.frame.height, 300)
    XCTAssertLessThanOrEqual(hero.frame.height, 360)

    let expandedTitle = app.staticTexts["detail.title"]
    let compactTitle = app.staticTexts["detail.compactTitle"]
    let genreBadge = app.staticTexts["detail.genreBadge"]
    XCTAssertTrue(expandedTitle.exists)
    XCTAssertEqual(expandedTitle.label, fullTitle)
    XCTAssertTrue(expandedTitle.isHittable)
    XCTAssertFalse(compactTitle.exists)
    XCTAssertTrue(genreBadge.exists)
    XCTAssertEqual(genreBadge.label, "主菜")
    XCTAssertGreaterThanOrEqual(genreBadge.frame.minY, hero.frame.maxY - 1)
    XCTAssertGreaterThan(expandedTitle.frame.minY, genreBadge.frame.maxY)
    XCTAssertTrue(app.buttons["detail.edit"].exists)
    XCTAssertFalse(app.staticTexts["ジャンル"].exists)

    for _ in 0..<4 where !compactTitle.exists {
      app.swipeUp()
    }
    XCTAssertTrue(compactTitle.waitForExistence(timeout: 2))
    XCTAssertEqual(compactTitle.label, fullTitle)

    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Recipe detail kitchen notebook"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testRecipeDetailShowsServingsControlsOnOneRow() {
    let app = launch()
    XCTAssertTrue(app.staticTexts["親子丼"].waitForExistence(timeout: 5))
    app.staticTexts["親子丼"].tap()

    let servings = app.staticTexts["detail.servingsValue"]
    let materialsServings = app.staticTexts["detail.materialsServingsValue"]
    let minusButton = app.buttons["detail.servingsMinus"]
    let plusButton = app.buttons["detail.servingsPlus"]
    XCTAssertTrue(servings.waitForExistence(timeout: 3))
    XCTAssertTrue(materialsServings.exists)
    XCTAssertEqual(servings.label, "2人分")
    XCTAssertEqual(materialsServings.label, "2人分")
    XCTAssertTrue(minusButton.exists)
    XCTAssertTrue(plusButton.exists)
    XCTAssertEqual(servings.frame.midY, minusButton.frame.midY, accuracy: 4)
    XCTAssertEqual(servings.frame.midY, plusButton.frame.midY, accuracy: 4)
    XCTAssertFalse(app.staticTexts["人数"].exists)
    XCTAssertFalse(app.staticTexts["表示人数: 2人"].exists)

    plusButton.tap()
    expectation(for: NSPredicate(format: "label == %@", "3人分"), evaluatedWith: servings)
    expectation(
      for: NSPredicate(format: "label == %@", "3人分"), evaluatedWith: materialsServings)
    waitForExpectations(timeout: 2)
  }
}

@MainActor final class HomeNavigationUITests: FoodfolioUITestCase {
  func testDrawerContainsSettingsAndAccount() {
    let app = launch()
    app.buttons["home.drawer"].tap()
    XCTAssertTrue(app.buttons["drawer.settings"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["drawer.account"].exists)
    app.buttons["drawer.settings"].tap()
    XCTAssertTrue(app.switches["settings.analysisNotification"].waitForExistence(timeout: 3))
  }

  func testDrawerKeepsSearchBarVerticalPositionStableAndOmitsIntroCopy() {
    let app = launch()
    let searchButton = app.buttons["home.search"]
    let drawerButton = app.buttons["home.drawer"]
    let settingsButton = app.buttons["drawer.settings"]

    XCTAssertTrue(searchButton.waitForExistence(timeout: 3))
    XCTAssertTrue(drawerButton.waitForExistence(timeout: 3))
    XCTAssertFalse(app.staticTexts["わたしのレシピ"].exists)
    XCTAssertFalse(app.staticTexts["いつもの味を、ここに。"].exists)
    let initialMinY = searchButton.frame.minY

    drawerButton.tap()
    XCTAssertTrue(settingsButton.waitForExistence(timeout: 3))
    XCTAssertEqual(searchButton.frame.minY, initialMinY, accuracy: 2)

    app.buttons["閉じる"].tap()
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: settingsButton)
    waitForExpectations(timeout: 3)
    XCTAssertEqual(searchButton.frame.minY, initialMinY, accuracy: 2)
  }

  func testBrandTitleIsBesideDrawerIconAndOpensDrawer() {
    let app = launch()
    let drawerIcon = app.buttons["home.drawer"]
    let brandButton = app.buttons["home.brandTitle"]

    XCTAssertTrue(drawerIcon.waitForExistence(timeout: 3))
    XCTAssertTrue(brandButton.waitForExistence(timeout: 3))
    XCTAssertTrue(brandButton.label.contains("foodfolio"))
    XCTAssertTrue(brandButton.isHittable)
    let gap = brandButton.frame.minX - drawerIcon.frame.maxX
    XCTAssertGreaterThanOrEqual(gap, 0)
    XCTAssertLessThanOrEqual(gap, 10)
    XCTAssertLessThanOrEqual(brandButton.frame.maxX, app.frame.maxX)
    XCTAssertGreaterThan(brandButton.frame.width, 55)
    XCTAssertEqual(brandButton.frame.midY, drawerIcon.frame.midY, accuracy: 2)

    brandButton.tap()
    XCTAssertTrue(app.buttons["drawer.settings"].waitForExistence(timeout: 3))
  }
}

@MainActor final class AuthenticationUITests: FoodfolioUITestCase {
  func testLoggedOutAuthenticationAndPasswordReset() {
    let app = launch(arguments: ["-ui-testing-logged-out"])
    XCTAssertTrue(app.buttons["auth.google"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["auth.emailContinue"].exists)
    app.buttons["auth.emailContinue"].tap()
    app.textFields["auth.email"].tap()
    app.textFields["auth.email"].typeText("ui@example.com")
    app.buttons["auth.resetPassword"].tap()
    XCTAssertTrue(app.staticTexts["リセットメールを送信しました。"].waitForExistence(timeout: 3))

    app.navigationBars.buttons.firstMatch.tap()
    XCTAssertTrue(app.buttons["auth.google"].waitForExistence(timeout: 3))
    app.buttons["auth.google"].tap()
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 3))
  }

  func testAuthenticationMethodsUseConsistentButtonGeometry() {
    let app = launch(arguments: ["-ui-testing-logged-out"])
    let apple = app.buttons["auth.apple"]
    let google = app.buttons["auth.google"]
    let email = app.buttons["auth.emailContinue"]

    XCTAssertTrue(apple.waitForExistence(timeout: 3))
    XCTAssertTrue(google.exists)
    XCTAssertTrue(email.exists)

    XCTAssertEqual(apple.frame.height, 52, accuracy: 2)
    XCTAssertEqual(google.frame.height, 52, accuracy: 2)
    XCTAssertEqual(email.frame.height, 52, accuracy: 2)
    XCTAssertEqual(apple.frame.width, google.frame.width, accuracy: 2)
    XCTAssertEqual(apple.frame.width, email.frame.width, accuracy: 2)
  }

  func testAppleAuthenticationAdapter() {
    let app = launch(arguments: ["-ui-testing-logged-out"])
    XCTAssertTrue(app.buttons["auth.apple"].waitForExistence(timeout: 3))
    app.buttons["auth.apple"].tap()
    XCTAssertTrue(app.buttons["home.add"].waitForExistence(timeout: 3))
  }
}

@MainActor final class MutationAndAccountUITests: FoodfolioUITestCase {
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

  func testAccountDeletionRequiresConfirmation() {
    let app = launch()
    app.buttons["home.drawer"].tap()
    app.buttons["drawer.account"].tap()
    XCTAssertTrue(app.buttons["account.delete"].waitForExistence(timeout: 3))

    app.buttons["account.delete"].tap()
    let deleteAlert = app.alerts["アカウント削除"]
    XCTAssertTrue(deleteAlert.waitForExistence(timeout: 2))
    XCTAssertTrue(deleteAlert.staticTexts["アカウントとすべてのデータを完全に削除しますか？"].exists)
    XCTAssertTrue(deleteAlert.buttons["完全に削除"].exists)
    XCTAssertTrue(deleteAlert.buttons["キャンセル"].exists)
    deleteAlert.buttons["キャンセル"].tap()
    XCTAssertTrue(app.staticTexts["account.email"].exists)
  }

  func testNotificationToggleAndLogout() {
    let app = launch()
    app.buttons["home.drawer"].tap()
    app.buttons["drawer.settings"].tap()
    let toggle = app.switches["settings.analysisNotification"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 3))
    XCTAssertTrue(app.descendants(matching: .any)["settings.privacyPolicy"].exists)
    XCTAssertTrue(app.descendants(matching: .any)["settings.support"].exists)
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
    XCTAssertTrue(app.staticTexts["email"].waitForExistence(timeout: 3))
    XCTAssertEqual(app.staticTexts["account.email"].label, "ui@example.com")
    XCTAssertFalse(app.staticTexts["password"].exists)
    XCTAssertTrue(app.buttons["account.logout"].waitForExistence(timeout: 3))

    app.buttons["account.logout"].tap()
    let logoutAlert = app.alerts["ログアウト"]
    XCTAssertTrue(logoutAlert.waitForExistence(timeout: 2))
    XCTAssertTrue(logoutAlert.staticTexts["ログアウトしますか？"].exists)
    XCTAssertTrue(logoutAlert.buttons["ログアウト"].exists)
    XCTAssertTrue(logoutAlert.buttons["キャンセル"].exists)
    logoutAlert.buttons["キャンセル"].tap()
    XCTAssertTrue(app.staticTexts["account.email"].exists)

    app.buttons["account.logout"].tap()
    app.alerts["ログアウト"].buttons["ログアウト"].tap()
    XCTAssertTrue(app.buttons["auth.google"].waitForExistence(timeout: 3))
  }
}
