import Foundation

enum RecipeSyncReconciliationMode: Int {
  case scheduled
  case sessionStart
  case forced

  func merged(with other: RecipeSyncReconciliationMode) -> RecipeSyncReconciliationMode {
    rawValue >= other.rawValue ? self : other
  }
}

private struct RecipeBatchRequest: Encodable, Sendable {
  let ids: [String]
}

@MainActor
final class RecipeSyncService {
  private static let reconciliationInterval: TimeInterval = 86_400
  private static let batchSize = 100

  private let repository: RecipeRepository
  private let defaults: UserDefaults
  private let fetchSync: (String) async throws -> SyncResponse
  private let fetchRecipeIDs: () async throws -> RecipeIDsResponse
  private let fetchRecipes: ([String]) async throws -> RecipeBatchResponse
  private let cursorKey = "recipeSyncCursor"
  private let reconciliationKey = "lastFullReconciliationAt"
  private let tagRelationshipRepairKey = "tagRelationshipRepairVersion"
  private let tagRelationshipRepairVersion = 1
  private let recipeCacheSchemaVersionKey = "recipeCacheSchemaVersion"
  private let recipeCacheSchemaVersion = 1
  private var hasReconciledThisSession = false

  init(api: APIClient, repository: RecipeRepository, defaults: UserDefaults = .standard) {
    self.repository = repository
    self.defaults = defaults
    self.fetchSync = { path in try await api.get(path) }
    self.fetchRecipeIDs = { try await api.get("/v1/sync/recipe-ids") }
    self.fetchRecipes = { ids in
      try await api.send(
        "/v1/recipes/batch-get", method: "POST", body: RecipeBatchRequest(ids: ids))
    }
  }

  init(
    repository: RecipeRepository, defaults: UserDefaults,
    fetchSync: @escaping (String) async throws -> SyncResponse,
    fetchRecipeIDs: @escaping () async throws -> RecipeIDsResponse,
    fetchRecipes: @escaping ([String]) async throws -> RecipeBatchResponse = {
      _ in RecipeBatchResponse(recipes: [])
    }
  ) {
    self.repository = repository
    self.defaults = defaults
    self.fetchSync = fetchSync
    self.fetchRecipeIDs = fetchRecipeIDs
    self.fetchRecipes = fetchRecipes
  }

  func sync(
    now: Date = Date(), reconciliation: RecipeSyncReconciliationMode = .scheduled
  ) async throws {
    let needsTagRelationshipRepair =
      defaults.integer(forKey: tagRelationshipRepairKey) < tagRelationshipRepairVersion
    let needsRecipeCacheRefresh =
      defaults.integer(forKey: recipeCacheSchemaVersionKey) < recipeCacheSchemaVersion
    let cursor =
      needsTagRelationshipRepair || needsRecipeCacheRefresh
      ? nil : defaults.string(forKey: cursorKey)
    let path =
      cursor.map {
        "/v1/sync?cursor=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)"
      } ?? "/v1/sync"
    let response = try await fetchSync(path)
    try repository.upsert(tags: response.tags)
    for recipe in response.recipes { try await repository.upsert(recipe) }
    defaults.set(response.nextCursor, forKey: cursorKey)
    if needsTagRelationshipRepair {
      defaults.set(tagRelationshipRepairVersion, forKey: tagRelationshipRepairKey)
    }
    if needsRecipeCacheRefresh {
      defaults.set(recipeCacheSchemaVersion, forKey: recipeCacheSchemaVersionKey)
    }

    guard shouldReconcile(now: now, mode: reconciliation) else { return }
    try await reconcileRecipes()
    defaults.set(now, forKey: reconciliationKey)
    hasReconciledThisSession = true
  }

  func clearMetadata() {
    defaults.removeObject(forKey: cursorKey)
    defaults.removeObject(forKey: reconciliationKey)
    defaults.removeObject(forKey: tagRelationshipRepairKey)
    defaults.removeObject(forKey: recipeCacheSchemaVersionKey)
    hasReconciledThisSession = false
  }

  private func shouldReconcile(now: Date, mode: RecipeSyncReconciliationMode) -> Bool {
    switch mode {
    case .forced:
      return true
    case .sessionStart:
      return !hasReconciledThisSession
    case .scheduled:
      guard let last = defaults.object(forKey: reconciliationKey) as? Date else { return true }
      return now.timeIntervalSince(last) >= Self.reconciliationInterval
    }
  }

  private func reconcileRecipes() async throws {
    let localSnapshot = try repository.recipeIDs()
    let serverResponse = try await fetchRecipeIDs()
    let serverIDs = Set(serverResponse.recipeIds)
    let missingIDs = serverIDs.subtracting(localSnapshot).sorted()
    let staleLocalIDs = localSnapshot.subtracting(serverIDs)

    for start in stride(from: 0, to: missingIDs.count, by: Self.batchSize) {
      let end = min(start + Self.batchSize, missingIDs.count)
      let requestedIDs = Array(missingIDs[start..<end])
      let requestedSet = Set(requestedIDs)
      let response = try await fetchRecipes(requestedIDs)
      for recipe in response.recipes where requestedSet.contains(recipe.id) {
        try await repository.upsert(recipe)
      }
    }

    try await repository.removeLocalRecipes(ids: staleLocalIDs)
  }
}
