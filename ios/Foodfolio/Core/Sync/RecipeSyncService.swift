import Foundation

@MainActor
final class RecipeSyncService {
  private let repository: RecipeRepository
  private let defaults: UserDefaults
  private let fetchSync: (String) async throws -> SyncResponse
  private let fetchRecipeIDs: () async throws -> RecipeIDsResponse
  private let cursorKey = "recipeSyncCursor"
  private let reconciliationKey = "lastFullReconciliationAt"
  private let tagRelationshipRepairKey = "tagRelationshipRepairVersion"
  private let tagRelationshipRepairVersion = 1

  init(api: APIClient, repository: RecipeRepository, defaults: UserDefaults = .standard) {
    self.repository = repository
    self.defaults = defaults
    self.fetchSync = { path in try await api.get(path) }
    self.fetchRecipeIDs = { try await api.get("/v1/sync/recipe-ids") }
  }

  init(
    repository: RecipeRepository, defaults: UserDefaults,
    fetchSync: @escaping (String) async throws -> SyncResponse,
    fetchRecipeIDs: @escaping () async throws -> RecipeIDsResponse
  ) {
    self.repository = repository
    self.defaults = defaults
    self.fetchSync = fetchSync
    self.fetchRecipeIDs = fetchRecipeIDs
  }

  func sync(now: Date = Date()) async throws {
    let needsTagRelationshipRepair =
      defaults.integer(forKey: tagRelationshipRepairKey) < tagRelationshipRepairVersion
    let cursor = needsTagRelationshipRepair ? nil : defaults.string(forKey: cursorKey)
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
    let last = defaults.object(forKey: reconciliationKey) as? Date
    if last == nil || now.timeIntervalSince(last!) >= 86_400 {
      let ids = try await fetchRecipeIDs()
      try await repository.removeLocalRecipes(notIn: Set(ids.recipeIds))
      defaults.set(now, forKey: reconciliationKey)
    }
  }

  func clearMetadata() {
    defaults.removeObject(forKey: cursorKey)
    defaults.removeObject(forKey: reconciliationKey)
    defaults.removeObject(forKey: tagRelationshipRepairKey)
  }
}
