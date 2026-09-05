import Foundation
import Observation

struct AIConsentRecord: Equatable {
  let consentedAt: Date
}

@MainActor @Observable
final class AIConsentStore {
  static let appGroupIdentifier = "group.com.keyukt.foodfolio"
  private let defaults: UserDefaults
  private let key = "aiProcessingConsent"
  private(set) var consentedAt: Date?
  private(set) var needsServerSync: Bool

  init(defaults: UserDefaults? = nil) {
    self.defaults =
      defaults
      ?? UserDefaults(suiteName: Self.appGroupIdentifier)
      ?? .standard
    let saved = self.defaults.dictionary(forKey: key)
    let savedConsentedAt = saved?["consentedAt"] as? Date
    let wasServerSynchronized = saved?["serverSynchronized"] as? Bool ?? false

    if let savedConsentedAt, wasServerSynchronized {
      consentedAt = savedConsentedAt
    } else {
      consentedAt = nil
      if saved != nil { self.defaults.removeObject(forKey: key) }
    }
    needsServerSync = false
  }

  var isGranted: Bool { consentedAt != nil }

  var currentRecord: AIConsentRecord? {
    guard let consentedAt else { return nil }
    return AIConsentRecord(consentedAt: consentedAt)
  }

  func grant(at date: Date = Date()) {
    consentedAt = date
    needsServerSync = true
    persist(serverSynchronized: false)
  }

  func markServerSynchronized(consentedAt: Date?) {
    guard let consentedAt else {
      revoke()
      return
    }
    self.consentedAt = consentedAt
    needsServerSync = false
    persist(serverSynchronized: true)
  }

  func revoke() {
    consentedAt = nil
    needsServerSync = false
    defaults.removeObject(forKey: key)
  }

  private func persist(serverSynchronized: Bool) {
    guard let consentedAt else {
      defaults.removeObject(forKey: key)
      return
    }
    defaults.set(
      [
        "consentedAt": consentedAt,
        "serverSynchronized": serverSynchronized,
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
