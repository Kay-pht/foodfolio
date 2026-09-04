import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class AIConsentIntegrationTests: XCTestCase {
  private var modelContainer: ModelContainer?
  func testRecipeSubmissionIsBlockedUntilConsentIsGranted() async throws {
    let session = try makeSession()
    do {
      _ = try await session.addRecipe(url: "https://example.com/new-recipe")
      XCTFail("Submission must require consent")
    } catch { XCTAssertEqual(error as? AIConsentError, .required) }
    XCTAssertNil(try session.repository.recipe(id: "ui-added-recipe"))

    XCTAssertTrue(session.grantAIConsent(for: "ui-user"))
    let recipe = try await session.addRecipe(url: "https://example.com/new-recipe")
    XCTAssertEqual(recipe.id, "ui-added-recipe")
  }

  func testAccountChangeDoesNotReuseOrGrantPreviousUsersConsent() async throws {
    let session = try makeSession()
    XCTAssertTrue(session.grantAIConsent(for: "ui-user"))
    session.user = AuthenticatedUser(uid: "other-user", email: nil, providers: ["password"])
    XCTAssertFalse(session.grantAIConsent(for: "ui-user"))
    do {
      _ = try await session.addRecipe(url: "https://example.com/new-recipe")
      XCTFail("Another account must consent independently")
    } catch { XCTAssertEqual(error as? AIConsentError, .required) }
    XCTAssertNil(try session.repository.recipe(id: "ui-added-recipe"))
  }

  func testLogoutRemovesConsentAndBlocksFurtherSubmission() async throws {
    let session = try makeSession()
    XCTAssertTrue(session.grantAIConsent(for: "ui-user"))
    try await session.logout()
    XCTAssertNil(session.user)
    XCTAssertFalse(session.aiConsent.isGranted(for: "ui-user"))
    XCTAssertFalse(session.grantAIConsent(for: "ui-user"))
    do {
      _ = try await session.addRecipe(url: "https://example.com/new-recipe")
      XCTFail("Signed-out submission must be blocked")
    } catch { XCTAssertEqual(error as? AIConsentError, .required) }
  }

  private func makeSession() throws -> AppSession {
    let container = try ModelContainerFactory.make(inMemory: true)
    modelContainer = container
    return try AppSession(
      context: container.mainContext, uiTesting: true,
      aiConsentStore: AIConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!))
  }
}
