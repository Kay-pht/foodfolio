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
  private(set) var needsServerSync: Bool

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let saved = defaults.dictionary(forKey: key)
    approvedVersion = saved?["version"] as? Int ?? 0
    consentedAt = saved?["consentedAt"] as? Date
    needsServerSync = saved?["needsServerSync"] as? Bool ?? false
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
    needsServerSync = true
    persist()
  }

  func markServerSynchronized(version: Int?, consentedAt: Date?) {
    guard version == Self.currentVersion, let consentedAt else {
      revoke()
      return
    }
    approvedVersion = version
    self.consentedAt = consentedAt
    needsServerSync = false
    persist()
  }

  func revoke() {
    approvedVersion = 0
    consentedAt = nil
    needsServerSync = false
    defaults.removeObject(forKey: key)
  }

  private func persist() {
    guard let consentedAt else {
      defaults.removeObject(forKey: key)
      return
    }
    defaults.set(
      [
        "version": approvedVersion,
        "consentedAt": consentedAt,
        "needsServerSync": needsServerSync,
      ],
      forKey: key)
  }
}

enum AIConsentError: LocalizedError, Equatable {
  case required

  var errorDescription: String? {
    "Foodfolioを利用するには、AI解析のための情報送信への同意が必要です。"
  }
}
