import Foundation
import Observation

@MainActor @Observable
final class AIConsentStore {
  static let currentVersion = 1
  private let defaults: UserDefaults
  private let key = "aiProcessingConsent"
  private var approvedUserID: String?
  private var approvedVersion: Int

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let saved = defaults.dictionary(forKey: key)
    approvedUserID = saved?["userID"] as? String
    approvedVersion = saved?["version"] as? Int ?? 0
  }

  func isGranted(for userID: String?) -> Bool {
    guard let userID, !userID.isEmpty else { return false }
    return approvedUserID == userID && approvedVersion == Self.currentVersion
  }

  func grant(for userID: String) {
    guard !userID.isEmpty else { return }
    approvedUserID = userID
    approvedVersion = Self.currentVersion
    defaults.set(["userID": userID, "version": Self.currentVersion], forKey: key)
  }

  func revoke() {
    approvedUserID = nil
    approvedVersion = 0
    defaults.removeObject(forKey: key)
  }
}

enum AIConsentError: LocalizedError, Equatable {
  case required

  var errorDescription: String? {
    "AI解析を開始するには、外部サービスへの情報送信への同意が必要です。"
  }
}
