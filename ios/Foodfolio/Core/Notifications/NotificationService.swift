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
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    if Self.shouldRegisterForRemoteNotifications(status: settings.authorizationStatus) {
      UIApplication.shared.registerForRemoteNotifications()
      return
    }
    guard settings.authorizationStatus == .notDetermined else { return }
    if (try? await UNUserNotificationCenter.current().requestAuthorization(options: [
      .alert, .badge, .sound,
    ])) == true {
      UIApplication.shared.registerForRemoteNotifications()
    }
  }
  nonisolated static func shouldRegisterForRemoteNotifications(status: UNAuthorizationStatus)
    -> Bool
  {
    status == .authorized || status == .provisional || status == .ephemeral
  }
  nonisolated static func shouldShowOpenSettings(
    appNotificationEnabled: Bool, status: UNAuthorizationStatus
  ) -> Bool { appNotificationEnabled && status == .denied }
  func authorizationStatus() async -> UNAuthorizationStatus {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }
  func unregisterCurrentToken() async {
    guard let token = try? await Messaging.messaging().token() else { return }
    struct Body: Encodable, Sendable { let token: String }
    try? await api.sendWithoutResponse(
      "/v1/device-token", method: "DELETE", body: Body(token: token))
    try? await Messaging.messaging().deleteToken()
  }
  nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?)
  {
    guard let fcmToken else { return }
    Task { @MainActor in
      struct Body: Encodable, Sendable { let token: String }
      try? await api.sendWithoutResponse(
        "/v1/device-token", method: "PUT", body: Body(token: fcmToken))
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
}
