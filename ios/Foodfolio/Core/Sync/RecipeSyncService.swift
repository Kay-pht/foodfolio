import Foundation

@MainActor
final class RecipeSyncService {
  private let api: APIClient
  private let repository: RecipeRepository
  private let defaults: UserDefaults
  private let cursorKey = "recipeSyncCursor"
  private let reconciliationKey = "lastFullReconciliationAt"

  init(api: APIClient, repository: RecipeRepository, defaults: UserDefaults = .standard) {
    self.api = api
    self.repository = repository
    self.defaults = defaults
  }

  func sync(now: Date = Date()) async throws {
    let cursor = defaults.string(forKey: cursorKey)
    let path =
      cursor.map {
        "/v1/sync?cursor=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)"
      } ?? "/v1/sync"
    let response: SyncResponse = try await api.get(path)
    for recipe in response.recipes { try repository.upsert(recipe) }
    defaults.set(response.nextCursor, forKey: cursorKey)
    let last = defaults.object(forKey: reconciliationKey) as? Date
    if last == nil || now.timeIntervalSince(last!) >= 86_400 {
      let ids: RecipeIDsResponse = try await api.get("/v1/sync/recipe-ids")
      try await repository.removeLocalRecipes(notIn: Set(ids.recipeIds))
      defaults.set(now, forKey: reconciliationKey)
    }
  }

  func clearMetadata() {
    defaults.removeObject(forKey: cursorKey)
    defaults.removeObject(forKey: reconciliationKey)
  }
}
