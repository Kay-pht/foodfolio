import Foundation
import Observation

struct AIConsentRecord: Equatable {
  let version: Int
  let consentedAt: Date
}

@MainActor @Observable
final class AIConsentStore {
  static let currentVersion = 2
  private let defaults: UserDefaults
  private let key = "aiProcessingConsent"
  private(set) var approvedVersion: Int
  private(set) var consentedAt: Date?

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let saved = defaults.dictionary(forKey: key)
    approvedVersion = saved?["version"] as? Int ?? 0
    consentedAt = saved?["consentedAt"] as? Date
  }

  var isGranted: Bool {
    approvedVersion == Self.currentVersion && consentedAt != nil
  }

  var currentRecord: AIConsentRecord? {
    guard isGranted, let consentedAt else { return nil }
    return AIConsentRecord(version: approvedVersion, consentedAt: consentedAt)
  }

  func grant(at date: Date = Date()) {
    approvedVersion = Self.currentVersion
    consentedAt = date
    defaults.set(
      ["version": Self.currentVersion, "consentedAt": date],
      forKey: key)
  }

  func revoke() {
    approvedVersion = 0
    consentedAt = nil
    defaults.removeObject(forKey: key)
  }
}

enum AIConsentError: LocalizedError, Equatable {
  case required

  var errorDescription: String? {
    "Foodfolioを利用するには、AI解析のための情報送信への同意が必要です。"
  }
}
