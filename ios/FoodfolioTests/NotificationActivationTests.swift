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

  func testAPNsRegistrationRemainsBlockedWithoutSuccessCallback() {
    var state = APNsRegistrationState()
    state.beginRegistration()

    XCTAssertFalse(state.canSyncFCMToken)
  }
}
