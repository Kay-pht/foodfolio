import FirebaseCore
import FirebaseMessaging
import GoogleSignIn
import SwiftData
import SwiftUI
import UIKit

enum FoodfolioTheme {
  static let paper = Color(red: 0.984, green: 0.969, blue: 0.945)
  static let surface = Color(red: 1.0, green: 0.992, blue: 0.984)
  static let terracotta = Color(red: 0.847, green: 0.451, blue: 0.333)
  static let sage = Color(red: 0.506, green: 0.592, blue: 0.475)
  static let butter = Color(red: 0.914, green: 0.776, blue: 0.459)
  static let ink = Color(red: 0.2, green: 0.169, blue: 0.153)
  static let secondaryInk = Color(red: 0.475, green: 0.427, blue: 0.404)
  static let hairline = ink.opacity(0.1)
}

struct FoodfolioBackground: View {
  var body: some View {
    LinearGradient(
      colors: [FoodfolioTheme.paper, FoodfolioTheme.surface],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
    .ignoresSafeArea()
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    Messaging.messaging().apnsToken = deviceToken
    NotificationCenter.default.post(name: .foodfolioAPNsRegistrationDidSucceed, object: nil)
    #if DEBUG
      print("[NotificationService] APNs device token registered.")
    #endif
  }

  func application(
    _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    NotificationCenter.default.post(name: .foodfolioAPNsRegistrationDidFail, object: nil)
    #if DEBUG
      print(
        "[NotificationService] APNs remote notification registration failed: \(error.localizedDescription)"
      )
    #endif
  }
}

@main struct FoodfolioApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  private let container: ModelContainer
  @State private var session: AppSession
  private let mockMode: Bool

  init() {
    let uiTesting = ProcessInfo.processInfo.arguments.contains("-ui-testing")
    let testHost = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    let mockMode = uiTesting || testHost
    self.mockMode = mockMode
    if !mockMode, FirebaseApp.app() == nil,
      Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
    {
      FirebaseApp.configure()
    }
    do {
      let container = try ModelContainerFactory.make(inMemory: mockMode)
      self.container = container
      _session = State(
        initialValue: try AppSession(context: container.mainContext, uiTesting: mockMode))
    } catch { fatalError("Unable to initialize Foodfolio: \(error.localizedDescription)") }
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(session)
        .onOpenURL { url in _ = GIDSignIn.sharedInstance.handle(url) }
        .task {
          if !mockMode {
            do {
              try await SharedAuthentication.configure()
              session.refreshUser()
            } catch {
              session.globalError = "共有機能の認証状態を初期化できませんでした。"
            }
          }
          await session.restoreAuthenticatedSession()
        }
    }.modelContainer(container)
  }
}
