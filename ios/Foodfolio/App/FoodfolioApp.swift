import FirebaseCore
import FirebaseMessaging
import SwiftData
import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) { Messaging.messaging().apnsToken = deviceToken }
}

@main struct FoodfolioApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  private let container: ModelContainer
  @State private var session: AppSession

  init() {
    let uiTesting = ProcessInfo.processInfo.arguments.contains("-ui-testing")
    let testHost = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    let mockMode = uiTesting || testHost
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
  var body: some Scene { WindowGroup { RootView().environment(session) }.modelContainer(container) }
}
