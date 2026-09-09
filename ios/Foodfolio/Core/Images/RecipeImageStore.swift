import Foundation

struct RecipeImageRequest: Hashable, Sendable {
  let recipeID: String
  let imageURL: String?
  let originalURL: String
}

struct RecipeRemoteImage: Sendable {
  let data: Data
  fileprivate let recipeID: String
  fileprivate let generation: UUID
}

actor RecipeImageStore {
  private struct PendingRemoteLoad {
    let id: UUID
    let generation: UUID
    let task: Task<Data?, Never>
  }

  private let fileManager: FileManager
  private let root: URL
  private var loadGenerations: [String: UUID] = [:]
  private var pendingRemoteLoads: [RecipeImageRequest: PendingRemoteLoad] = [:]
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
    invalidatePendingRemoteLoad(recipeID: recipeID)
  }

  func remoteImage(
    for request: RecipeImageRequest,
    fetch: @escaping @Sendable () async -> Data?
  ) async -> RecipeRemoteImage? {
    if let pending = pendingRemoteLoads[request] {
      guard let data = await pending.task.value else { return nil }
      return RecipeRemoteImage(
        data: data, recipeID: request.recipeID, generation: pending.generation)
    }

    let generation = loadGenerations[request.recipeID] ?? UUID()
    loadGenerations[request.recipeID] = generation
    let id = UUID()
    let task = Task { await fetch() }
    pendingRemoteLoads[request] = PendingRemoteLoad(
      id: id, generation: generation, task: task)
    let data = await task.value
    if pendingRemoteLoads[request]?.id == id {
      pendingRemoteLoads.removeValue(forKey: request)
    }
    guard let data else { return nil }
    return RecipeRemoteImage(data: data, recipeID: request.recipeID, generation: generation)
  }

  func invalidatePendingRemoteLoad(recipeID: String) {
    loadGenerations[recipeID] = UUID()
    let requests = pendingRemoteLoads.keys.filter { $0.recipeID == recipeID }
    for request in requests {
      pendingRemoteLoads.removeValue(forKey: request)?.task.cancel()
    }
  }

  @discardableResult func store(
    _ remoteImage: RecipeRemoteImage, recipeID: String
  ) throws -> Bool {
    guard remoteImage.recipeID == recipeID,
      loadGenerations[recipeID] == remoteImage.generation
    else { return false }
    try remoteImage.data.write(to: url(for: recipeID), options: .atomic)
    return true
  }
  func remove(recipeID: String) throws {
    invalidatePendingRemoteLoad(recipeID: recipeID)
    loadGenerations.removeValue(forKey: recipeID)
    let target = url(for: recipeID)
    if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
  }
  func removeAll() throws {
    for pending in pendingRemoteLoads.values { pending.task.cancel() }
    pendingRemoteLoads.removeAll()
    loadGenerations.removeAll()
    if fileManager.fileExists(atPath: root.path) { try fileManager.removeItem(at: root) }
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
  }
}
