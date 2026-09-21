import XCTest

@testable import Foodfolio

final class NotificationActivationTests: XCTestCase {
  func testFirstLoginRequestsAuthorizationWhenStatusIsNotDetermined() {
    XCTAssertTrue(
      NotificationService.shouldRequestAuthorization(
        status: .notDetermined,
        requestAuthorizationIfNeeded: true
      ))
  }

  func testRestoredSessionDoesNotRequestAuthorizationWhenStatusIsNotDetermined() {
    XCTAssertFalse(
      NotificationService.shouldRequestAuthorization(
        status: .notDetermined,
        requestAuthorizationIfNeeded: false
      ))
  }

  func testAuthorizedSessionRegistersForRemoteNotifications() {
    XCTAssertTrue(NotificationService.shouldRegisterForRemoteNotifications(status: .authorized))
    XCTAssertTrue(NotificationService.shouldRegisterForRemoteNotifications(status: .provisional))
    XCTAssertTrue(NotificationService.shouldRegisterForRemoteNotifications(status: .ephemeral))
  }

  func testDeniedSessionDoesNotRegisterForRemoteNotifications() {
    XCTAssertFalse(NotificationService.shouldRegisterForRemoteNotifications(status: .denied))
  }

  func testFCMTokenSyncIsBlockedBeforeAPNsRegistrationSucceeds() {
    let state = APNsRegistrationState()

    XCTAssertFalse(state.canSyncFCMToken)
  }

  func testFCMTokenSyncIsEnabledOnlyAfterAPNsRegistrationSucceeds() {
    var state = APNsRegistrationState()

    state.beginRegistration()
    XCTAssertFalse(state.canSyncFCMToken)

    state.markSucceeded()
    XCTAssertTrue(state.canSyncFCMToken)
  }

  func testStartingNewAPNsRegistrationBlocksFCMTokenSyncAgain() {
    var state = APNsRegistrationState()
    state.markSucceeded()
    XCTAssertTrue(state.canSyncFCMToken)

    state.beginRegistration()

    XCTAssertFalse(state.canSyncFCMToken)
  }

  func testRepeatedAPNsSuccessKeepsFCMTokenSyncEnabled() {
    var state = APNsRegistrationState()

    state.markSucceeded()
    state.markSucceeded()

    XCTAssertTrue(state.canSyncFCMToken)
  }

  func testAPNsRegistrationFailureKeepsFCMTokenSyncBlocked() {
    var state = APNsRegistrationState()
    state.beginRegistration()

    state.markFailed()

    XCTAssertFalse(state.canSyncFCMToken)
  }

  func testAPNsRegistrationFailureClearsPreviouslyReadyState() {
    var state = APNsRegistrationState()
    state.markSucceeded()
    XCTAssertTrue(state.canSyncFCMToken)

    state.markFailed()

    XCTAssertFalse(state.canSyncFCMToken)
  }

  func testAnalysisNotificationRefreshesForTerminalResults() {
    XCTAssertEqual(
      NotificationService.recipeAnalysisRecipeID(from: [
        "recipeId": "completed-recipe", "analysisResult": "completed",
      ]),
      "completed-recipe"
    )
    XCTAssertEqual(
      NotificationService.recipeAnalysisRecipeID(from: [
        "recipeId": "failed-recipe", "analysisResult": "failed",
      ]),
      "failed-recipe"
    )
    XCTAssertEqual(
      NotificationService.recipeAnalysisRecipeID(from: [
        "recipeId": "not-recipe", "analysisResult": "not_recipe",
      ]),
      "not-recipe"
    )
  }

  func testAnalysisNotificationRefreshIgnoresMissingOrUnknownResult() {
    XCTAssertNil(
      NotificationService.recipeAnalysisRecipeID(from: [
        "recipeId": "recipe", "analysisResult": "processing",
      ]))
    XCTAssertNil(NotificationService.recipeAnalysisRecipeID(from: ["recipeId": "recipe"]))
    XCTAssertNil(
      NotificationService.recipeAnalysisRecipeID(from: [
        "recipeId": "", "analysisResult": "completed",
      ]))
  }

  func testAutoRefreshPollingOnlyRunsForInFlightStatuses() {
    XCTAssertTrue(AnalysisAutoRefreshPolicy.shouldPoll(status: .pending, isAppActive: true))
    XCTAssertTrue(AnalysisAutoRefreshPolicy.shouldPoll(status: .processing, isAppActive: true))
    XCTAssertFalse(AnalysisAutoRefreshPolicy.shouldPoll(status: .completed, isAppActive: true))
    XCTAssertFalse(AnalysisAutoRefreshPolicy.shouldPoll(status: .failed, isAppActive: true))
    XCTAssertFalse(AnalysisAutoRefreshPolicy.shouldPoll(status: .notRecipe, isAppActive: true))
    XCTAssertFalse(AnalysisAutoRefreshPolicy.shouldPoll(status: .pending, isAppActive: false))
    XCTAssertFalse(AnalysisAutoRefreshPolicy.shouldPoll(status: .processing, isAppActive: false))
  }
}

@MainActor final class RecipeSynchronizationCoordinatorTests: XCTestCase {
  func testSilentSynchronizationDoesNotReportAnOperationError() async {
    let coordinator = RecipeSynchronizationCoordinator { throw APIError.server }
    var reportedErrors = 0
    coordinator.onError = { _ in reportedErrors += 1 }

    await coordinator.synchronize(reportError: false)

    XCTAssertEqual(reportedErrors, 0)
    await coordinator.synchronize(reportError: true)
    XCTAssertEqual(reportedErrors, 1)
  }

  func testCancellationStopsSynchronizationWithoutReportingAnError() async {
    let started = expectation(description: "Synchronization started")
    let coordinator = RecipeSynchronizationCoordinator {
      started.fulfill()
      try await Task.sleep(for: .seconds(60))
    }
    var reportedErrors = 0
    coordinator.onError = { _ in reportedErrors += 1 }
    let synchronization = Task { await coordinator.synchronize(reportError: true) }

    await fulfillment(of: [started])
    await coordinator.cancel()
    await synchronization.value

    XCTAssertEqual(reportedErrors, 0)
  }
}
