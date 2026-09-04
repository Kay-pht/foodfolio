import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
  @Environment(AppSession.self) private var session
  @State private var enabled = true
  @State private var osStatus: UNAuthorizationStatus = .notDetermined
  @State private var isLoading = true
  @State private var error: String?
  var body: some View {
    Form {
      Section("通知") {
        Toggle("レシピ解析通知", isOn: $enabled).onChange(of: enabled) { _, value in update(value) }
          .accessibilityIdentifier("settings.analysisNotification")
          .accessibilityValue(enabled ? "オン" : "オフ")
          .disabled(isLoading)
        if NotificationService.shouldShowOpenSettings(
          appNotificationEnabled: enabled, status: osStatus)
        {
          Text("通知はiOS設定で無効になっています").foregroundStyle(.orange)
          Button("設定を開く") {
            UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
          }
        }
      }
      Section("情報") {
        Link("プライバシーポリシー", destination: FoodfolioLinks.privacyPolicy)
          .accessibilityIdentifier("settings.privacyPolicy")
        Link("サポート・お問い合わせ", destination: FoodfolioLinks.support)
          .accessibilityIdentifier("settings.support")
      }
      if isLoading { ProgressView() }
      if let error { Text(error).foregroundStyle(.red) }
    }.navigationTitle("設定").task { await load() }
  }
  private func load() async {
    defer { isLoading = false }
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

enum FoodfolioLinks {
  static let privacyPolicy = URL(string: "https://foodfolio-af28aa.web.app/privacy")!
  static let support = URL(string: "https://foodfolio-af28aa.web.app/support")!
}
