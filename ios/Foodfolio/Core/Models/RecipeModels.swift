import Foundation
import SwiftData

enum AnalysisStatus: String, Codable, CaseIterable {
  case pending, processing, completed, failed
  case notRecipe = "not_recipe"
}
enum RecipeGenre: String, Codable, CaseIterable {
  case main = "主菜"
  case side = "副菜"
  case staple = "主食"
  case noodles = "麺"
  case soup = "スープ・汁物"
  case salad = "サラダ"
  case dessert = "デザート"
  case other = "その他"

  var badgeColor: GenreBadgeColor {
    switch self {
    case .main: .red
    case .side: .orange
    case .staple: .yellow
    case .noodles: .purple
    case .soup: .blue
    case .salad: .green
    case .dessert: .pink
    case .other: .gray
    }
  }
}

enum GenreBadgeColor: String, CaseIterable {
  case red, orange, yellow, purple, blue, green, pink, gray
}

@Model final class LocalIngredient {
  @Attribute(.unique) var id: String
  var name: String
  var amount: String?
  var sortOrder: Int
  init(id: String, name: String, amount: String?, sortOrder: Int) {
    self.id = id
    self.name = name
    self.amount = amount
    self.sortOrder = sortOrder
  }
}

@Model final class LocalRecipeStep {
  @Attribute(.unique) var id: String
  var text: String
  var sortOrder: Int
  init(id: String, text: String, sortOrder: Int) {
    self.id = id
    self.text = text
    self.sortOrder = sortOrder
  }
}

@Model final class LocalTag {
  @Attribute(.unique) var id: String
  var name: String
  var createdAt: Date
  var recipes: [LocalRecipe]

  init(id: String, name: String, createdAt: Date, recipes: [LocalRecipe] = []) {
    self.id = id
    self.name = name
    self.createdAt = createdAt
    self.recipes = recipes
  }
}

@Model final class LocalRecipe {
  @Attribute(.unique) var id: String
  var originalUrl: String
  var sourceType: String
  var title: String
  var imageUrl: String?
  var servingsValue: Double?
  var servingsRaw: String?
  var cookingTimeMinutes: Int?
  var genreRaw: String?
  var analysisStatusRaw: String
  var wantToCookAt: Date?
  var createdAt: Date
  var updatedAt: Date
  @Relationship(deleteRule: .cascade) var ingredients: [LocalIngredient]
  @Relationship(deleteRule: .cascade) var steps: [LocalRecipeStep]
  @Relationship(inverse: \LocalTag.recipes) var tags: [LocalTag]

  var analysisStatus: AnalysisStatus { AnalysisStatus(rawValue: analysisStatusRaw) ?? .failed }
  var genre: RecipeGenre? { genreRaw.flatMap(RecipeGenre.init(rawValue:)) }

  init(
    id: String, originalUrl: String, sourceType: String, title: String, imageUrl: String? = nil,
    servingsValue: Double? = nil, servingsRaw: String? = nil, cookingTimeMinutes: Int? = nil,
    genreRaw: String? = nil, analysisStatus: AnalysisStatus = .pending, wantToCookAt: Date? = nil,
    createdAt: Date, updatedAt: Date,
    ingredients: [LocalIngredient] = [], steps: [LocalRecipeStep] = [], tags: [LocalTag] = []
  ) {
    self.id = id
    self.originalUrl = originalUrl
    self.sourceType = sourceType
    self.title = title
    self.imageUrl = imageUrl
    self.servingsValue = servingsValue
    self.servingsRaw = servingsRaw
    self.cookingTimeMinutes = cookingTimeMinutes
    self.genreRaw = genreRaw
    self.analysisStatusRaw = analysisStatus.rawValue
    self.wantToCookAt = wantToCookAt
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.ingredients = ingredients
    self.steps = steps
    self.tags = tags
  }
}
