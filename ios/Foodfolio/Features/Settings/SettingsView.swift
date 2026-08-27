import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
  @Environment(AppSession.self) private var session
  @State private var enabled = true
  @State private var osStatus: UNAuthorizationStatus = .notDetermined
  @State private var error: String?
  var body: some View {
    Form {
      Section("通知") {
        Toggle("レシピ解析通知", isOn: $enabled).onChange(of: enabled) { _, value in update(value) }
          .accessibilityIdentifier("settings.analysisNotification")
        if NotificationService.shouldShowOpenSettings(
          appNotificationEnabled: enabled, status: osStatus)
        {
          Text("通知はiOS設定で無効になっています").foregroundStyle(.orange)
          Button("設定を開く") {
            UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
          }
        }
      }
      if let error { Text(error).foregroundStyle(.red) }
    }.navigationTitle("設定").task { await load() }
  }
  private func load() async {
    do {
      let setting: SettingDTO = try await session.api.get("/v1/settings")
      enabled = setting.recipeAnalysisNotificationEnabled
      osStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    } catch { self.error = error.localizedDescription }
  }
  private func update(_ value: Bool) {
    Task {
      struct Body: Encodable, Sendable { let recipeAnalysisNotificationEnabled: Bool }
      do {
        let _: SettingDTO = try await session.api.send(
          "/v1/settings", method: "PATCH", body: Body(recipeAnalysisNotificationEnabled: value))
      } catch { self.error = error.localizedDescription }
    }
  }
}
