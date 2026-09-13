#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPOSITORY_DIR="${SCRIPT_DIR}/.."
readonly DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

export DEVELOPER_DIR

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foodfolio-swiftdata-migration.XXXXXX")"
readonly WORK_DIR
readonly STORE_URL="${WORK_DIR}/legacy.store"
readonly LEGACY_DIR="${WORK_DIR}/legacy"
readonly CURRENT_DIR="${WORK_DIR}/current"
mkdir -p "${LEGACY_DIR}" "${CURRENT_DIR}"

cleanup() {
  rm -rf -- "${WORK_DIR}"
}
trap cleanup EXIT

cat >"${LEGACY_DIR}/main.swift" <<'SWIFT'
import Foundation
import SwiftData

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

  init(id: String, name: String, createdAt: Date) {
    self.id = id
    self.name = name
    self.createdAt = createdAt
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
  var createdAt: Date
  var updatedAt: Date
  @Relationship(deleteRule: .cascade) var ingredients: [LocalIngredient]
  @Relationship(deleteRule: .cascade) var steps: [LocalRecipeStep]
  var tags: [LocalTag]

  init(
    id: String, originalUrl: String, sourceType: String, title: String, imageUrl: String? = nil,
    servingsValue: Double? = nil, servingsRaw: String? = nil, cookingTimeMinutes: Int? = nil,
    genreRaw: String? = nil, analysisStatusRaw: String, createdAt: Date, updatedAt: Date,
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
    self.analysisStatusRaw = analysisStatusRaw
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.ingredients = ingredients
    self.steps = steps
    self.tags = tags
  }
}

let storeURL = URL(fileURLWithPath: CommandLine.arguments[1])
let schema = Schema([
  LocalRecipe.self, LocalIngredient.self, LocalRecipeStep.self, LocalTag.self,
])
let container = try ModelContainer(
  for: schema,
  configurations: ModelConfiguration(schema: schema, url: storeURL))
let context = container.mainContext
let date = Date(timeIntervalSince1970: 1_700_000_000)
let tag = LocalTag(id: "kei", name: "Kei", createdAt: date)
let ingredient = LocalIngredient(id: "ingredient-1", name: "玉ねぎ", amount: "1個", sortOrder: 0)
let step = LocalRecipeStep(id: "step-1", text: "炒める", sortOrder: 0)
let recipe = LocalRecipe(
  id: "r1",
  originalUrl: "https://example.com/r1",
  sourceType: "web",
  title: "Legacy recipe",
  analysisStatusRaw: "completed",
  createdAt: date,
  updatedAt: date,
  ingredients: [ingredient],
  steps: [step],
  tags: [tag])
context.insert(tag)
context.insert(recipe)
try context.save()
SWIFT

xcrun --sdk macosx swiftc \
  -swift-version 6 \
  -framework SwiftData \
  "${LEGACY_DIR}/main.swift" \
  -o "${LEGACY_DIR}/create-legacy-store"
"${LEGACY_DIR}/create-legacy-store" "${STORE_URL}"

cat >"${CURRENT_DIR}/main.swift" <<'SWIFT'
import Foundation
import SwiftData

let storeURL = URL(fileURLWithPath: CommandLine.arguments[1])
let container = try ModelContainerFactory.make(storeURL: storeURL)
let context = container.mainContext
let recipes = try context.fetch(FetchDescriptor<LocalRecipe>())
let tags = try context.fetch(FetchDescriptor<LocalTag>())

guard recipes.count == 1, let first = recipes.first else {
  fatalError("Expected one legacy recipe after migration, found \(recipes.count)")
}
guard tags.count == 1, let sharedTag = tags.first else {
  fatalError("Expected one legacy tag after migration, found \(tags.count)")
}
guard first.id == "r1", first.title == "Legacy recipe" else {
  fatalError("Legacy recipe identity or title was not preserved")
}
guard first.wantToCookAt == nil else {
  fatalError("Legacy recipe must default to an unmarked want-to-cook state")
}
guard first.ingredients.map(\.id) == ["ingredient-1"] else {
  fatalError("Legacy ingredients were not preserved")
}
guard first.steps.map(\.id) == ["step-1"] else {
  fatalError("Legacy steps were not preserved")
}
guard first.tags.map(\.id) == ["kei"] else {
  fatalError("Legacy recipe-tag relationship was not preserved")
}
guard sharedTag.id == "kei", sharedTag.name == "Kei" else {
  fatalError("Legacy tag identity or name was not preserved")
}

let second = LocalRecipe(
  id: "r2",
  originalUrl: "https://example.com/r2",
  sourceType: "web",
  title: "Second recipe",
  analysisStatus: .completed,
  createdAt: first.createdAt,
  updatedAt: first.updatedAt,
  tags: [sharedTag])
context.insert(second)
try context.save()

let migratedRecipes = try context.fetch(FetchDescriptor<LocalRecipe>())
let recipesWithSharedTag = migratedRecipes
  .filter { recipe in recipe.tags.contains { $0.id == "kei" } }
  .map(\.id)
  .sorted()
guard recipesWithSharedTag == ["r1", "r2"] else {
  fatalError("Shared tag did not remain attached after migration: \(recipesWithSharedTag)")
}
guard sharedTag.recipes.map(\.id).sorted() == ["r1", "r2"] else {
  fatalError("Migrated inverse relationship is incomplete")
}

print("SwiftData legacy-store migration verified")
SWIFT

xcrun --sdk macosx swiftc \
  -swift-version 6 \
  -framework SwiftData \
  "${REPOSITORY_DIR}/ios/Foodfolio/Core/Models/RecipeModels.swift" \
  "${REPOSITORY_DIR}/ios/Foodfolio/Core/Persistence/ModelContainerFactory.swift" \
  "${CURRENT_DIR}/main.swift" \
  -o "${CURRENT_DIR}/verify-current-store"
"${CURRENT_DIR}/verify-current-store" "${STORE_URL}"
