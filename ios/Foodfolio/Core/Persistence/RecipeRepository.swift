import Foundation
import SwiftData

@MainActor
final class RecipeRepository {
  private let context: ModelContext
  private let api: APIClient
  private let images: RecipeImageStore

  init(context: ModelContext, api: APIClient, images: RecipeImageStore) {
    self.context = context
    self.api = api
    self.images = images
  }

  func allRecipes() throws -> [LocalRecipe] {
    try context.fetch(
      FetchDescriptor<LocalRecipe>(sortBy: [SortDescriptor(\.createdAt, order: .reverse)]))
  }
  func recipe(id: String) throws -> LocalRecipe? {
    try context.fetch(FetchDescriptor<LocalRecipe>(predicate: #Predicate { $0.id == id })).first
  }
  func allTags() throws -> [LocalTag] {
    try context.fetch(FetchDescriptor<LocalTag>(sortBy: [SortDescriptor(\.createdAt)]))
  }

  func add(url: String) async throws -> LocalRecipe {
    struct Body: Encodable, Sendable { let url: String }
    let dto: RecipeDTO = try await api.send("/v1/recipes", method: "POST", body: Body(url: url))
    return try await upsert(dto)
  }

  func update(id: String, title: String, genre: RecipeGenre?, ingredients: [(String, String?)])
    async throws -> LocalRecipe
  {
    struct Item: Encodable, Sendable {
      let name: String
      let amount: String?
    }
    struct Body: Encodable, Sendable {
      let title: String
      let genre: String?
      let ingredients: [Item]
    }
    let dto: RecipeDTO = try await api.send(
      "/v1/recipes/\(id)", method: "PATCH",
      body: Body(title: title, genre: genre?.rawValue, ingredients: ingredients.map(Item.init)))
    return try await upsert(dto)
  }

  func delete(id: String) async throws {
    try await api.sendWithoutResponse(
      "/v1/recipes/\(id)", method: "DELETE", body: Optional<String>.none)
    if let recipe = try recipe(id: id) {
      context.delete(recipe)
      try context.save()
    }
    try await images.remove(recipeID: id)
  }

  func createTag(name: String) async throws -> TagDTO {
    struct Body: Encodable, Sendable { let name: String }
    return try await api.send("/v1/tags", method: "POST", body: Body(name: name))
  }

  func addTags(existingTagIDs: [String], newTagNames: [String], recipeID: String)
    async throws -> LocalRecipe
  {
    struct Body: Encodable, Sendable {
      let tagIds: [String]
      let newTagNames: [String]
    }
    let dto: RecipeDTO = try await api.send(
      "/v1/recipes/\(recipeID)/tags/batch", method: "POST",
      body: Body(tagIds: existingTagIDs, newTagNames: newTagNames))
    return try await upsert(dto)
  }

  func attach(tagID: String, recipeID: String) async throws -> LocalRecipe {
    struct Body: Encodable, Sendable { let tagId: String }
    let dto: RecipeDTO = try await api.send(
      "/v1/recipes/\(recipeID)/tags", method: "POST", body: Body(tagId: tagID))
    return try await upsert(dto)
  }

  func detach(tagID: String, recipeID: String) async throws {
    try await api.sendWithoutResponse(
      "/v1/recipes/\(recipeID)/tags/\(tagID)", method: "DELETE", body: Optional<String>.none)
    if let recipe = try recipe(id: recipeID) {
      recipe.tags.removeAll { $0.id == tagID }
      try context.save()
    }
  }

  func search(query: String, genre: RecipeGenre?, tagID: String?) throws -> [LocalRecipe] {
    let tokens = query.split(whereSeparator: \.isWhitespace).map { $0.lowercased() }
    return try allRecipes().filter { recipe in
      let searchable = ([recipe.title] + recipe.ingredients.map(\.name)).map { $0.lowercased() }
      let textMatches = tokens.allSatisfy { token in
        searchable.contains { $0.localizedCaseInsensitiveContains(token) }
      }
      let genreMatches = genre == nil || recipe.genre == genre
      let tagMatches = tagID == nil || recipe.tags.contains { $0.id == tagID }
      return textMatches && genreMatches && tagMatches
    }
  }

  @discardableResult func upsert(_ dto: RecipeDTO) async throws -> LocalRecipe {
    let local =
      try recipe(id: dto.id)
      ?? LocalRecipe(
        id: dto.id, originalUrl: dto.originalUrl, sourceType: dto.sourceType, title: dto.title,
        createdAt: dto.createdAt, updatedAt: dto.updatedAt)
    if local.modelContext == nil { context.insert(local) }
    if local.imageUrl != dto.imageUrl { try? await images.remove(recipeID: dto.id) }
    local.originalUrl = dto.originalUrl
    local.sourceType = dto.sourceType
    local.title = dto.title
    local.imageUrl = dto.imageUrl
    local.servingsValue = dto.servingsValue
    local.servingsRaw = dto.servingsRaw
    local.cookingTimeMinutes = dto.cookingTimeMinutes
    local.genreRaw = dto.genre
    local.analysisStatusRaw = dto.analysisStatus.rawValue
    local.createdAt = dto.createdAt
    local.updatedAt = dto.updatedAt
    local.ingredients.forEach(context.delete)
    local.steps.forEach(context.delete)
    local.ingredients = dto.ingredients.map {
      LocalIngredient(id: $0.id, name: $0.name, amount: $0.amount, sortOrder: $0.sortOrder)
    }
    local.steps = dto.steps.map {
      LocalRecipeStep(id: $0.id, text: $0.text, sortOrder: $0.sortOrder)
    }
    local.tags = try dto.tags.map(upsertTag)
    try context.save()
    return local
  }

  func removeLocalRecipes(notIn serverIDs: Set<String>) async throws {
    for recipe in try allRecipes() where !serverIDs.contains(recipe.id) {
      context.delete(recipe)
      try await images.remove(recipeID: recipe.id)
    }
    try context.save()
  }

  func upsert(tags: [TagDTO]) throws {
    for tag in tags { _ = try upsertTag(tag) }
    try context.save()
  }

  func clearLocalData() async throws {
    try context.delete(model: LocalRecipe.self)
    try context.delete(model: LocalTag.self)
    try context.save()
    try await images.removeAll()
  }

  private func upsertTag(_ dto: TagDTO) throws -> LocalTag {
    let id = dto.id
    let tag =
      try context.fetch(FetchDescriptor<LocalTag>(predicate: #Predicate { $0.id == id })).first
      ?? LocalTag(id: dto.id, name: dto.name, createdAt: dto.createdAt)
    if tag.modelContext == nil { context.insert(tag) }
    tag.name = dto.name
    tag.createdAt = dto.createdAt
    return tag
  }
}
