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

  func testAPNsRegistrationIsNotReadyInitially() {
    let state = APNsRegistrationState()

    XCTAssertFalse(state.isReady)
  }

  func testAPNsRegistrationBecomesReadyOnlyAfterSuccess() {
    var state = APNsRegistrationState()

    state.beginRegistration()
    XCTAssertFalse(state.isReady)

    state.markSucceeded()
    XCTAssertTrue(state.isReady)
  }

  func testStartingNewAPNsRegistrationBlocksFCMSyncAgain() {
    var state = APNsRegistrationState()
    state.markSucceeded()
    XCTAssertTrue(state.isReady)

    state.beginRegistration()

    XCTAssertFalse(state.isReady)
  }
}
