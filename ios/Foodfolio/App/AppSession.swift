import Foundation
import Observation
import SwiftData

@MainActor @Observable final class AppSession {
  var user: AuthenticatedUser?
  var globalError: String?
  let auth: AuthService
  let api: APIClient
  let repository: RecipeRepository
  let syncService: RecipeSyncService
  let history: SearchHistoryStore
  let images: RecipeImageStore
  let notifications: NotificationService?
  let uiTesting: Bool
  var pendingRecipeID: String?

  init(
    context: ModelContext,
    uiTesting: Bool = ProcessInfo.processInfo.arguments.contains("-ui-testing")
  ) throws {
    self.uiTesting = uiTesting
    let auth: AuthService = uiTesting ? UITestAuthService() : FirebaseAuthService()
    self.auth = auth
    self.user = auth.currentUser
    let configuredBaseURL =
      ProcessInfo.processInfo.environment["API_BASE_URL"]
      ?? Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
      ?? "http://127.0.0.1:8080"
    guard let base = URL(string: configuredBaseURL) else { throw APIError.invalidURL }
    let api = APIClient(
      baseURL: base, tokenProvider: uiTesting ? StaticTokenProvider() : FirebaseTokenProvider())
    self.api = api
    let images = try RecipeImageStore()
    self.images = images
    let repository = RecipeRepository(context: context, api: api, images: images)
    self.repository = repository
    self.syncService = RecipeSyncService(api: api, repository: repository)
    self.history = SearchHistoryStore()
    self.notifications = uiTesting ? nil : NotificationService(api: api)
    self.notifications?.onRecipeOpened = { [weak self] recipeID in self?.pendingRecipeID = recipeID
    }
    if uiTesting { seedUITestData(context: context) }
  }

  func refreshUser() { user = auth.currentUser }
  func didAuthenticate() async {
    refreshUser()
    await notifications?.requestAfterFirstLogin()
    await synchronize()
  }
  func synchronize() async {
    do { try await syncService.sync() } catch {
      globalError = (error as? APIError)?.userMessage ?? "同期に失敗しました。"
    }
  }
  func logout() async throws {
    await notifications?.unregisterCurrentToken()
    try auth.signOut()
    try await repository.clearLocalData()
    syncService.clearMetadata()
    history.removeAll()
    refreshUser()
  }

  private func seedUITestData(context: ModelContext) {
    guard (try? repository.allRecipes().isEmpty) == true else { return }
    let recipe = LocalRecipe(
      id: "ui-recipe", originalUrl: "https://example.com/oyakodon", sourceType: "web", title: "親子丼",
      servingsValue: 2, servingsRaw: "2人分", cookingTimeMinutes: 20, genreRaw: "主菜",
      analysisStatus: .completed, createdAt: Date(), updatedAt: Date(),
      ingredients: [
        LocalIngredient(id: "ui-ingredient", name: "鶏もも肉", amount: "200g", sortOrder: 0)
      ], steps: [LocalRecipeStep(id: "ui-step", text: "材料を煮る", sortOrder: 0)],
      tags: [LocalTag(id: "ui-tag", name: "簡単", createdAt: Date())])
    context.insert(recipe)
    try? context.save()
  }
}

private struct StaticTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "ui-test-token" }
}

@MainActor private final class UITestAuthService: AuthService {
  var currentUser: AuthenticatedUser? = AuthenticatedUser(
    uid: "ui-user", email: "ui@example.com", providers: ["password"])
  func signIn(email: String, password: String) async throws {}
  func signUp(email: String, password: String) async throws {}
  func resetPassword(email: String) async throws {}
  func signInWithGoogle() async throws {}
  func signInWithApple() async throws {}
  func revokeAppleToken() async throws {}
  func signOut() throws { currentUser = nil }
}
