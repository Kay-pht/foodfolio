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

  func testAnalysisNotificationRefreshesForCompletedAndFailedResults() {
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
    XCTAssertTrue(AnalysisAutoRefreshPolicy.shouldPoll(status: .pending))
    XCTAssertTrue(AnalysisAutoRefreshPolicy.shouldPoll(status: .processing))
    XCTAssertFalse(AnalysisAutoRefreshPolicy.shouldPoll(status: .completed))
    XCTAssertFalse(AnalysisAutoRefreshPolicy.shouldPoll(status: .failed))
  }
}
