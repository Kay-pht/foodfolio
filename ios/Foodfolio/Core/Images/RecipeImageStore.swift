import Foundation

actor RecipeImageStore {
  private let fileManager: FileManager
  private let root: URL
  private var pendingLoadTokens: [String: UUID] = [:]
  init(fileManager: FileManager = .default, root: URL? = nil) throws {
    self.fileManager = fileManager
    let base =
      try root
      ?? fileManager.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    self.root = base.appending(path: "Foodfolio/RecipeImages", directoryHint: .isDirectory)
    try fileManager.createDirectory(at: self.root, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableRoot = self.root
    try mutableRoot.setResourceValues(values)
  }
  func url(for recipeID: String) -> URL { root.appending(path: recipeID) }
  func data(for recipeID: String) -> Data? { try? Data(contentsOf: url(for: recipeID)) }
  func store(_ data: Data, recipeID: String) throws {
    try data.write(to: url(for: recipeID), options: .atomic)
    pendingLoadTokens.removeValue(forKey: recipeID)
  }
  func beginRemoteLoad(recipeID: String) -> UUID {
    let token = UUID()
    pendingLoadTokens[recipeID] = token
    return token
  }
  func cancelRemoteLoad(recipeID: String, token: UUID) {
    guard pendingLoadTokens[recipeID] == token else { return }
    pendingLoadTokens.removeValue(forKey: recipeID)
  }
  func invalidatePendingRemoteLoad(recipeID: String) {
    pendingLoadTokens.removeValue(forKey: recipeID)
  }
  @discardableResult func store(
    _ data: Data, recipeID: String, ifCurrent token: UUID
  ) throws -> Bool {
    guard pendingLoadTokens[recipeID] == token else { return false }
    try data.write(to: url(for: recipeID), options: .atomic)
    pendingLoadTokens.removeValue(forKey: recipeID)
    return true
  }
  func remove(recipeID: String) throws {
    pendingLoadTokens.removeValue(forKey: recipeID)
    let target = url(for: recipeID)
    if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
  }
  func removeAll() throws {
    pendingLoadTokens.removeAll()
    if fileManager.fileExists(atPath: root.path) { try fileManager.removeItem(at: root) }
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
  }
}
