import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

extension Notification.Name {
  static let foodfolioAPNsRegistrationDidSucceed = Notification.Name(
    "foodfolioAPNsRegistrationDidSucceed")
  static let foodfolioAPNsRegistrationDidFail = Notification.Name(
    "foodfolioAPNsRegistrationDidFail")
}

struct APNsRegistrationState {
  private(set) var canSyncFCMToken = false

  mutating func beginRegistration() {
    canSyncFCMToken = false
  }

  mutating func markSucceeded() {
    canSyncFCMToken = true
  }

  mutating func markFailed() {
    canSyncFCMToken = false
  }
}

@MainActor
final class NotificationService: NSObject, UNUserNotificationCenterDelegate, MessagingDelegate {
  private let api: APIClient
  private var apnsRegistrationState = APNsRegistrationState()
  var onRecipeAnalysisResultReceived: ((String) -> Void)?
  var onRecipeOpened: ((String) -> Void)?

  init(api: APIClient) {
    self.api = api
    super.init()
    UNUserNotificationCenter.current().delegate = self
    Messaging.messaging().delegate = self
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAPNsRegistrationDidSucceed),
      name: .foodfolioAPNsRegistrationDidSucceed,
      object: nil)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAPNsRegistrationDidFail),
      name: .foodfolioAPNsRegistrationDidFail,
      object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  func requestAfterFirstLogin() async {
    await activate(requestAuthorizationIfNeeded: true)
  }

  func restoreAuthenticatedSession() async {
    await activate(requestAuthorizationIfNeeded: false)
  }

  private func activate(requestAuthorizationIfNeeded: Bool) async {
    let settings = await UNUserNotificationCenter.current().notificationSettings()

    if Self.shouldRegisterForRemoteNotifications(status: settings.authorizationStatus) {
      beginAPNsRegistration()
      return
    }

    guard
      Self.shouldRequestAuthorization(
        status: settings.authorizationStatus,
        requestAuthorizationIfNeeded: requestAuthorizationIfNeeded)
    else { return }

    do {
      let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [
        .alert, .badge, .sound,
      ])
      guard granted else { return }
      beginAPNsRegistration()
    } catch {
      debugLog("Notification authorization request failed: \(error.localizedDescription)")
    }
  }

  nonisolated static func shouldRegisterForRemoteNotifications(status: UNAuthorizationStatus)
    -> Bool
  {
    status == .authorized || status == .provisional || status == .ephemeral
  }

  nonisolated static func shouldRequestAuthorization(
    status: UNAuthorizationStatus,
    requestAuthorizationIfNeeded: Bool
  ) -> Bool {
    requestAuthorizationIfNeeded && status == .notDetermined
  }

  nonisolated static func shouldShowOpenSettings(
    appNotificationEnabled: Bool, status: UNAuthorizationStatus
  ) -> Bool { appNotificationEnabled && status == .denied }

  nonisolated static func recipeAnalysisRecipeID(from userInfo: [AnyHashable: Any]) -> String? {
    guard
      let recipeID = userInfo["recipeId"] as? String,
      !recipeID.isEmpty,
      let result = userInfo["analysisResult"] as? String,
      result == "completed" || result == "failed"
    else { return nil }
    return recipeID
  }

  func authorizationStatus() async -> UNAuthorizationStatus {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  func unregisterCurrentToken() async {
    do {
      let token = try await Messaging.messaging().token()
      struct Body: Encodable, Sendable { let token: String }
      try await api.sendWithoutResponse(
        "/v1/device-token", method: "DELETE", body: Body(token: token))
    } catch {
      debugLog("FCM token unregister failed: \(error.localizedDescription)")
    }

    do {
      try await Messaging.messaging().deleteToken()
    } catch {
      debugLog("FCM token deletion failed: \(error.localizedDescription)")
    }
  }

  nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?)
  {
    guard let fcmToken else { return }
    Task { @MainActor [weak self] in
      guard let self else { return }
      guard apnsRegistrationState.canSyncFCMToken else {
        debugLog("Ignoring FCM token callback until APNs registration succeeds.")
        return
      }
      await registerToken(fcmToken, source: "Firebase callback")
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    let userInfo = notification.request.content.userInfo
    if let recipeID = Self.recipeAnalysisRecipeID(from: userInfo) {
      await MainActor.run { onRecipeAnalysisResultReceived?(recipeID) }
    }
    return [.banner, .sound]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    guard let recipeID = response.notification.request.content.userInfo["recipeId"] as? String
    else { return }
    await MainActor.run { onRecipeOpened?(recipeID) }
  }

  @objc nonisolated private func handleAPNsRegistrationDidSucceed() {
    Task { @MainActor [weak self] in
      guard let self else { return }
      apnsRegistrationState.markSucceeded()
      await syncCurrentToken()
    }
  }

  @objc nonisolated private func handleAPNsRegistrationDidFail() {
    Task { @MainActor [weak self] in
      self?.apnsRegistrationState.markFailed()
    }
  }

  private func beginAPNsRegistration() {
    apnsRegistrationState.beginRegistration()
    UIApplication.shared.registerForRemoteNotifications()
  }

  private func syncCurrentToken() async {
    guard apnsRegistrationState.canSyncFCMToken else {
      debugLog("Skipping FCM token sync until APNs registration succeeds.")
      return
    }

    do {
      let token = try await Messaging.messaging().token()
      await registerToken(token, source: "APNs registration sync")
    } catch {
      debugLog("FCM token retrieval failed: \(error.localizedDescription)")
    }
  }

  private func registerToken(_ token: String, source: String) async {
    struct Body: Encodable, Sendable { let token: String }
    do {
      try await api.sendWithoutResponse(
        "/v1/device-token", method: "PUT", body: Body(token: token))
      debugLog("FCM token registered from \(source).")
    } catch {
      debugLog("FCM token registration failed from \(source): \(error.localizedDescription)")
    }
  }

  private func debugLog(_ message: String) {
    #if DEBUG
      print("[NotificationService] \(message)")
    #endif
  }
}
