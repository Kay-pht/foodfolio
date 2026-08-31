import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

@MainActor
final class NotificationService: NSObject, UNUserNotificationCenterDelegate, MessagingDelegate {
  private let api: APIClient
  var onRecipeOpened: ((String) -> Void)?

  init(api: APIClient) {
    self.api = api
    super.init()
    UNUserNotificationCenter.current().delegate = self
    Messaging.messaging().delegate = self
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
      UIApplication.shared.registerForRemoteNotifications()
      await syncCurrentToken()
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
      UIApplication.shared.registerForRemoteNotifications()
      await syncCurrentToken()
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
    Task { @MainActor in
      await registerToken(fcmToken, source: "Firebase callback")
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions { [.banner, .sound] }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    guard let recipeID = response.notification.request.content.userInfo["recipeId"] as? String
    else { return }
    await MainActor.run { onRecipeOpened?(recipeID) }
  }

  private func syncCurrentToken() async {
    do {
      let token = try await Messaging.messaging().token()
      await registerToken(token, source: "authenticated session sync")
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
