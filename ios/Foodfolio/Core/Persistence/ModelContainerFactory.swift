import Foundation
import SwiftData

enum ModelContainerFactory {
  static func make(inMemory: Bool = false) throws -> ModelContainer {
    let schema = makeSchema()
    return try ModelContainer(
      for: schema,
      configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: inMemory))
  }

  static func make(storeURL: URL) throws -> ModelContainer {
    let schema = makeSchema()
    return try ModelContainer(
      for: schema,
      configurations: ModelConfiguration(schema: schema, url: storeURL))
  }

  private static func makeSchema() -> Schema {
    Schema([
      LocalRecipe.self, LocalIngredient.self, LocalRecipeStep.self, LocalTag.self,
    ])
  }
}
