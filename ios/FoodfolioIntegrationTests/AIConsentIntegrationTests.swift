import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class AIConsentIntegrationTests: XCTestCase {
  private var modelContainer: ModelContainer?

  func testRecipeSubmissionIsBlockedUntilPreLoginConsentIsAccepted() async throws {
    let session = try makeSession()
    do {
      _ = try await session.addRecipe(url: "https://example.com/new-recipe")
      XCTFail("Submission must require consent")
    } catch { XCTAssertEqual(error as? AIConsentError, .required) }
    XCTAssertNil(try session.repository.recipe(id: "ui-added-recipe"))

    try await session.acceptAIConsent()
    XCTAssertTrue(session.aiConsent.isGranted)
    XCTAssertTrue(session.isAIConsentReadyForAuthenticatedUse)
    let recipe = try await session.addRecipe(url: "https://example.com/new-recipe")
    XCTAssertEqual(recipe.id, "ui-added-recipe")
  }

  func testRevocationBlocksTheAppUntilConsentIsAcceptedAgain() async throws {
    let session = try makeSession()
    try await session.acceptAIConsent()
    try await session.revokeAIConsent()

    XCTAssertFalse(session.aiConsent.isGranted)
    XCTAssertFalse(session.isAIConsentReadyForAuthenticatedUse)
    do {
      _ = try await session.addRecipe(url: "https://example.com/new-recipe")
      XCTFail("Submission must be blocked after revocation")
    } catch { XCTAssertEqual(error as? AIConsentError, .required) }

    try await session.acceptAIConsent()
    XCTAssertTrue(session.aiConsent.isGranted)
    XCTAssertTrue(session.isAIConsentReadyForAuthenticatedUse)
  }

  func testLogoutPreservesDeviceConsentButEndsAuthenticatedReadiness() async throws {
    let session = try makeSession()
    try await session.acceptAIConsent()
    try await session.logout()

    XCTAssertNil(session.user)
    XCTAssertTrue(session.aiConsent.isGranted)
    XCTAssertFalse(session.isAIConsentReadyForAuthenticatedUse)
  }

  private func makeSession() throws -> AppSession {
    let container = try ModelContainerFactory.make(inMemory: true)
    modelContainer = container
    return try AppSession(
      context: container.mainContext, uiTesting: true,
      aiConsentStore: AIConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!))
  }
}
