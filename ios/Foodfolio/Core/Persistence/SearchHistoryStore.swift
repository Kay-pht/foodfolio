import Foundation

struct SearchHistoryStore {
  private let defaults: UserDefaults
  private let key: String
  init(defaults: UserDefaults = .standard, key: String = "recipeSearchHistory") {
    self.defaults = defaults
    self.key = key
  }
  var values: [String] { defaults.stringArray(forKey: key) ?? [] }
  func add(_ raw: String) {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return }
    defaults.set(Array(([value] + values.filter { $0 != value }).prefix(10)), forKey: key)
  }
  func remove(_ value: String) { defaults.set(values.filter { $0 != value }, forKey: key) }
  func removeAll() { defaults.removeObject(forKey: key) }
}
