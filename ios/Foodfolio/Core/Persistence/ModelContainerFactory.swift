import SwiftData

enum ModelContainerFactory {
  static func make(inMemory: Bool = false) throws -> ModelContainer {
    let schema = Schema([
      LocalRecipe.self, LocalIngredient.self, LocalRecipeStep.self, LocalTag.self,
    ])
    return try ModelContainer(
      for: schema,
      configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: inMemory))
  }
}
