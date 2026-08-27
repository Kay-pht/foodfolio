import Foundation

actor RecipeImageStore {
  private let fileManager: FileManager
  private let root: URL
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
  }
  func remove(recipeID: String) throws {
    let target = url(for: recipeID)
    if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
  }
  func removeAll() throws {
    if fileManager.fileExists(atPath: root.path) { try fileManager.removeItem(at: root) }
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
  }
}
