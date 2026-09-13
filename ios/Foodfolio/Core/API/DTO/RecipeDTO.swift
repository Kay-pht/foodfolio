import Foundation

struct IngredientDTO: Codable, Equatable, Sendable {
  let id: String
  let name: String
  let amount: String?
  let sortOrder: Int
}
struct RecipeStepDTO: Codable, Equatable, Sendable {
  let id: String
  let text: String
  let sortOrder: Int
}
struct TagDTO: Codable, Equatable, Sendable {
  let id: String
  let name: String
  let createdAt: Date
}
struct RecipeDTO: Codable, Equatable, Sendable {
  let id: String
  let originalUrl: String
  let sourceType: String
  let title: String
  let imageUrl: String?
  let servingsValue: Double?
  let servingsRaw: String?
  let cookingTimeMinutes: Int?
  let genre: String?
  let analysisStatus: AnalysisStatus
  let wantToCookAt: Date?
  let ingredients: [IngredientDTO]
  let steps: [RecipeStepDTO]
  let tags: [TagDTO]
  let createdAt: Date
  let updatedAt: Date

  init(
    id: String, originalUrl: String, sourceType: String, title: String, imageUrl: String?,
    servingsValue: Double?, servingsRaw: String?, cookingTimeMinutes: Int?, genre: String?,
    analysisStatus: AnalysisStatus, wantToCookAt: Date? = nil, ingredients: [IngredientDTO],
    steps: [RecipeStepDTO], tags: [TagDTO], createdAt: Date, updatedAt: Date
  ) {
    self.id = id
    self.originalUrl = originalUrl
    self.sourceType = sourceType
    self.title = title
    self.imageUrl = imageUrl
    self.servingsValue = servingsValue
    self.servingsRaw = servingsRaw
    self.cookingTimeMinutes = cookingTimeMinutes
    self.genre = genre
    self.analysisStatus = analysisStatus
    self.wantToCookAt = wantToCookAt
    self.ingredients = ingredients
    self.steps = steps
    self.tags = tags
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}
struct SyncResponse: Codable, Sendable {
  let recipes: [RecipeDTO]
  let tags: [TagDTO]
  let nextCursor: String
}
struct RecipeIDsResponse: Codable, Sendable { let recipeIds: [String] }
struct SettingDTO: Codable, Sendable { let recipeAnalysisNotificationEnabled: Bool }
