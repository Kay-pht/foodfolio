import Foundation
import Observation

struct AIConsentRecord: Equatable {
  let consentedAt: Date
}

@MainActor @Observable
final class AIConsentStore {
  static let appGroupIdentifier = "group.com.keyukt.foodfolio"
  private static let consentKey = "aiProcessingConsent"

  private let defaults: UserDefaults
  private let legacyDefaults: UserDefaults?
  private(set) var consentedAt: Date?
  private(set) var needsServerSync: Bool

  init(defaults: UserDefaults? = nil) {
    if let defaults {
      self.defaults = defaults
      self.legacyDefaults = nil
    } else if let sharedDefaults = UserDefaults(suiteName: Self.appGroupIdentifier) {
      self.defaults = sharedDefaults
      self.legacyDefaults = .standard
      if sharedDefaults.object(forKey: Self.consentKey) == nil,
        let legacyValue = UserDefaults.standard.object(forKey: Self.consentKey)
      {
        sharedDefaults.set(legacyValue, forKey: Self.consentKey)
        UserDefaults.standard.removeObject(forKey: Self.consentKey)
      }
    } else {
      self.defaults = .standard
      self.legacyDefaults = nil
    }

    let saved = self.defaults.dictionary(forKey: Self.consentKey)
    let savedConsentedAt = saved?["consentedAt"] as? Date
    let wasServerSynchronized = saved?["serverSynchronized"] as? Bool ?? false

    if let savedConsentedAt, wasServerSynchronized {
      consentedAt = savedConsentedAt
    } else {
      consentedAt = nil
      if saved != nil { self.defaults.removeObject(forKey: Self.consentKey) }
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
    defaults.removeObject(forKey: Self.consentKey)
    legacyDefaults?.removeObject(forKey: Self.consentKey)
  }

  private func persist(serverSynchronized: Bool) {
    guard let consentedAt else {
      defaults.removeObject(forKey: Self.consentKey)
      return
    }
    defaults.set(
      [
        "consentedAt": consentedAt,
        "serverSynchronized": serverSynchronized,
      ],
      forKey: Self.consentKey)
  }
}

enum AIConsentError: LocalizedError, Equatable {
  case required

  var errorDescription: String? {
    "Foodfolioを利用するには、AI解析のための情報送信への同意が必要です。"
  }
}
