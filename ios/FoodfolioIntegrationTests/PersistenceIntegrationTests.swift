import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class PersistenceIntegrationTests: XCTestCase {
  func testStepUpdateRoundTripsOrderAndClearThroughMutationResponseAndPersistence() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let repository = try makeStepRepository(container: container)
    let date = Date(timeIntervalSince1970: 1_800_000_000)
    try await repository.upsert(makeRecipe(id: "step-recipe", date: date))

    let saved = try await repository.update(
      id: "step-recipe", title: "編集済み", genre: .main, ingredients: [],
      steps: ["盛り付ける", "煮る\n弱火で5分"])
    XCTAssertEqual(
      saved.steps.sorted { $0.sortOrder < $1.sortOrder }.map(\.text),
      ["盛り付ける", "煮る\n弱火で5分"])
    XCTAssertEqual(saved.steps.map(\.sortOrder).sorted(), [0, 1])
    let persisted = try XCTUnwrap(
      ModelContext(container).fetch(FetchDescriptor<LocalRecipe>()).first)
    XCTAssertEqual(
      persisted.steps.sorted { $0.sortOrder < $1.sortOrder }.map(\.text),
      ["盛り付ける", "煮る\n弱火で5分"])

    let cleared = try await repository.update(
      id: "step-recipe", title: "編集済み", genre: .main, ingredients: [], steps: [])
    XCTAssertTrue(cleared.steps.isEmpty)
    let legacy = try await repository.update(
      id: "step-recipe", title: "編集済み", genre: .main, ingredients: [])
    XCTAssertEqual(legacy.steps.map(\.text), ["既存の手順"])
  }

  func testFailedStepUpdateLeavesPersistedInstructionsUntouched() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let repository = try makeStepRepository(container: container, fail: true)
    let date = Date(timeIntervalSince1970: 1_800_000_000)
    let local = try await repository.upsert(makeRecipe(id: "step-recipe", date: date))
    local.steps = [LocalRecipeStep(id: "old-step", text: "元の手順", sortOrder: 0)]
    try container.mainContext.save()
    do {
      _ = try await repository.update(
        id: "step-recipe", title: "変更済み", genre: .main, ingredients: [], steps: [])
      XCTFail("Step mutation must fail")
    } catch {
      XCTAssertEqual(error as? APIError, .offline)
    }
    XCTAssertEqual(try repository.recipe(id: "step-recipe")?.title, "step-recipe")
    XCTAssertEqual(try repository.recipe(id: "step-recipe")?.steps.map(\.text), ["元の手順"])
  }

  private func makeStepRepository(container: ModelContainer, fail: Bool = false) throws
    -> RecipeRepository
  {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StepMutationURLProtocol.self]
    return RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: fail ? "https://offline.invalid" : "https://step-edit.invalid")!,
        tokenProvider: TestTokenProvider(), session: URLSession(configuration: configuration)),
      images: try RecipeImageStore(
        root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)))
  }

  func testUpsertSearchAndHardDeleteReconciliation() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: imageStore)
    let date = Date()
    let dto = RecipeDTO(
      id: "r1", originalUrl: "https://example.com", sourceType: "web", title: "鶏肉カレー",
      imageUrl: nil, servingsValue: 2, servingsRaw: "2人分", cookingTimeMinutes: 30, genre: "主菜",
      analysisStatus: .completed, wantToCookAt: nil,
      ingredients: [IngredientDTO(id: "i1", name: "玉ねぎ", amount: "1個", sortOrder: 0)], steps: [],
      tags: [TagDTO(id: "t1", name: "簡単", createdAt: date)], createdAt: date, updatedAt: date)
    try await repository.upsert(dto)
    XCTAssertEqual(
      try repository.search(query: "鶏肉 玉ねぎ", genre: .main, tagID: "t1").map(\.id), ["r1"])
    XCTAssertTrue(try repository.search(query: "", genre: .main, tagID: nil).count == 1)
    let updated = RecipeDTO(
      id: "r1", originalUrl: "https://example.com", sourceType: "web", title: "更新後のカレー",
      imageUrl: nil, servingsValue: 4, servingsRaw: "4人分", cookingTimeMinutes: 25, genre: "主菜",
      analysisStatus: .completed, wantToCookAt: nil,
      ingredients: [
        IngredientDTO(id: "i1", name: "玉ねぎ", amount: "2個", sortOrder: 0),
        IngredientDTO(id: "i2", name: "鶏肉", amount: "400g", sortOrder: 1),
      ], steps: [], tags: [TagDTO(id: "t1", name: "簡単", createdAt: date)], createdAt: date,
      updatedAt: date.addingTimeInterval(1))
    try await repository.upsert(updated)
    XCTAssertEqual(try repository.recipe(id: "r1")?.title, "更新後のカレー")
    XCTAssertEqual(try repository.recipe(id: "r1")?.ingredients.count, 2)
    try await repository.removeLocalRecipes(notIn: [])
    XCTAssertTrue(try repository.allRecipes().isEmpty)
  }

  func testSharedTagRemainsAttachedToMultipleRecipesAndSearchReturnsAll() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: try RecipeImageStore(root: root))
    let date = Date()
    let sharedTag = TagDTO(id: "kei", name: "Kei", createdAt: date)

    try await repository.upsert(makeRecipe(id: "r1", date: date, tags: [sharedTag]))
    try await repository.upsert(
      makeRecipe(id: "r2", date: date.addingTimeInterval(1), tags: [sharedTag]))
    try await repository.upsert(makeRecipe(id: "r1", date: date, tags: [sharedTag]))

    XCTAssertEqual(try repository.recipe(id: "r1")?.tags.map(\.id), ["kei"])
    XCTAssertEqual(try repository.recipe(id: "r2")?.tags.map(\.id), ["kei"])
    XCTAssertEqual(
      try repository.search(query: "", genre: nil, tagID: "kei").map(\.id).sorted(), ["r1", "r2"])
    let tag = try XCTUnwrap(try repository.allTags().first { $0.id == "kei" })
    XCTAssertEqual(tag.recipes.map(\.id).sorted(), ["r1", "r2"])
  }

  func testWantToCookStateIsUpsertedAndPartitionedNewestFirst() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: try RecipeImageStore(root: root))
    let date = Date(timeIntervalSince1970: 1_800_000_000)
    let olderMark = date.addingTimeInterval(10)
    let newerMark = date.addingTimeInterval(20)

    try await repository.upsert(
      makeRecipe(id: "older", date: date, wantToCookAt: olderMark))
    try await repository.upsert(
      makeRecipe(id: "newer", date: date.addingTimeInterval(1), wantToCookAt: newerMark))
    try await repository.upsert(
      makeRecipe(id: "normal", date: date.addingTimeInterval(2)))

    let recipes = try repository.allRecipes()
    XCTAssertEqual(
      RecipeListPresentation.wantToCookRecipes(recipes).map(\.id), ["newer", "older"])
    XCTAssertEqual(RecipeListPresentation.otherRecipes(recipes).map(\.id), ["normal"])
    XCTAssertEqual(try repository.recipe(id: "older")?.wantToCookAt, olderMark)

    try await repository.upsert(makeRecipe(id: "older", date: date, wantToCookAt: nil))
    let updatedRecipes = try repository.allRecipes()
    XCTAssertEqual(RecipeListPresentation.wantToCookRecipes(updatedRecipes).map(\.id), ["newer"])
    XCTAssertEqual(
      Set(RecipeListPresentation.otherRecipes(updatedRecipes).map(\.id)), Set(["normal", "older"]))
    XCTAssertTrue(
      RecipeListPresentation.wantToCookRecipes([try XCTUnwrap(repository.recipe(id: "normal"))])
        .isEmpty)
  }

  func testMemoIsUpsertedAndExcludedFromSearch() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: try RecipeImageStore(root: root))
    let date = Date()

    try await repository.upsert(
      makeRecipe(id: "memo-recipe", date: date, memo: "味が濃かった。次回は醤油を減らす。"))

    XCTAssertEqual(
      try repository.recipe(id: "memo-recipe")?.memo,
      "味が濃かった。次回は醤油を減らす。")
    XCTAssertTrue(try repository.search(query: "濃かった", genre: nil, tagID: nil).isEmpty)
    XCTAssertEqual(
      try repository.search(query: "memo-recipe", genre: nil, tagID: nil).map(\.id),
      ["memo-recipe"])
  }

  func testImageStoreWritesReadsAndCleansUp() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let store = try RecipeImageStore(root: root)
    let data = Data("image".utf8)
    try await store.store(data, recipeID: "recipe")
    let storedData = await store.data(for: "recipe")
    XCTAssertEqual(storedData, data)
    try await store.remove(recipeID: "recipe")
    let removedData = await store.data(for: "recipe")
    XCTAssertNil(removedData)
  }

  func testImageURLChangeRetainsCachedImage() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: imageStore)
    let date = Date()

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/old.jpg"))
    try await imageStore.store(validPNGData, recipeID: "recipe")
    let cachedData = await imageStore.data(for: "recipe")
    let cachedBeforeUpdate = try XCTUnwrap(cachedData)

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/new.jpg"))

    let cachedAfterUpdate = await imageStore.data(for: "recipe")
    XCTAssertEqual(cachedAfterUpdate, cachedBeforeUpdate)
  }

  func testImageURLChangeRejectsPendingOldURLImage() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: imageStore)
    let date = Date()

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/old.jpg"))
    let oldRequest = RecipeImageRequest(
      recipeID: "recipe", imageURL: "https://cdn.example.com/old.jpg",
      originalURL: "https://example.com/recipe")
    let fetchRecorder = RemoteImageFetchRecorder()
    let oldLoad = Task {
      await imageStore.remoteImage(for: oldRequest) {
        await fetchRecorder.fetch(validPNGData, delay: .seconds(10))
      }
    }
    await fetchRecorder.waitUntilStarted()

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/new.jpg"))

    let oldImage = await oldLoad.value
    let stored = try await imageStore.store(try XCTUnwrap(oldImage), recipeID: "recipe")
    let cachedAfterUpdate = await imageStore.data(for: "recipe")
    XCTAssertFalse(stored)
    XCTAssertNil(cachedAfterUpdate)
  }

  func testConcurrentViewsShareRemoteLoadAndCanBothStoreItsResult() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let request = RecipeImageRequest(
      recipeID: "recipe", imageURL: "https://cdn.example.com/image.jpg",
      originalURL: "https://example.com/recipe")
    let fetchRecorder = RemoteImageFetchRecorder()

    async let first = imageStore.remoteImage(for: request) {
      await fetchRecorder.fetch(validPNGData, delay: .milliseconds(100))
    }
    async let second = imageStore.remoteImage(for: request) {
      await fetchRecorder.fetch(validPNGData, delay: .milliseconds(100))
    }
    let (firstImage, secondImage) = await (first, second)
    let fetchCount = await fetchRecorder.count
    let firstStored = try await imageStore.store(try XCTUnwrap(firstImage), recipeID: "recipe")
    let secondStored = try await imageStore.store(try XCTUnwrap(secondImage), recipeID: "recipe")
    let storedData = await imageStore.data(for: "recipe")

    XCTAssertEqual(fetchCount, 1)
    XCTAssertTrue(firstStored)
    XCTAssertTrue(secondStored)
    XCTAssertEqual(storedData, validPNGData)
  }

  func testRecipeRemovalRejectsPendingRemoteImage() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let request = RecipeImageRequest(
      recipeID: "recipe", imageURL: "https://cdn.example.com/image.jpg",
      originalURL: "https://example.com/recipe")
    let fetchRecorder = RemoteImageFetchRecorder()
    let remoteLoad = Task {
      await imageStore.remoteImage(for: request) {
        await fetchRecorder.fetch(validPNGData, delay: .seconds(10))
      }
    }
    await fetchRecorder.waitUntilStarted()

    try await imageStore.remove(recipeID: "recipe")

    let remoteImage = await remoteLoad.value
    let stored = try await imageStore.store(try XCTUnwrap(remoteImage), recipeID: "recipe")
    let storedData = await imageStore.data(for: "recipe")
    XCTAssertFalse(stored)
    XCTAssertNil(storedData)
  }

  func testDifferentialSyncPersistsCursorGlobalTagsAndReconcilesIDs() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let date = Date()
    try await repository.upsert(makeRecipe(id: "local-only", date: date))
    var requestedPaths: [String] = []
    var responses = [
      SyncResponse(
        recipes: [makeRecipe(id: "server", date: date)],
        tags: [TagDTO(id: "unused-tag", name: "作り置き", createdAt: date)],
        nextCursor: "cursor-1"),
      SyncResponse(recipes: [], tags: [], nextCursor: "cursor-2"),
    ]
    var reconciliationCount = 0
    let service = RecipeSyncService(
      repository: repository, defaults: defaults,
      fetchSync: { path in
        requestedPaths.append(path)
        return responses.removeFirst()
      },
      fetchRecipeIDs: {
        reconciliationCount += 1
        return RecipeIDsResponse(recipeIds: ["server"])
      })

    try await service.sync(now: date)
    XCTAssertEqual(requestedPaths, ["/v1/sync"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "cursor-1")
    XCTAssertEqual(defaults.integer(forKey: "tagRelationshipRepairVersion"), 1)
    XCTAssertEqual(try repository.allRecipes().map(\.id), ["server"])
    XCTAssertEqual(try repository.allTags().map(\.id).sorted(), ["unused-tag"])

    try await service.sync(now: date.addingTimeInterval(60))
    XCTAssertEqual(requestedPaths, ["/v1/sync", "/v1/sync?cursor=cursor-1"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "cursor-2")
    XCTAssertEqual(reconciliationCount, 1)
  }
}

private let validPNGData = Data(
  base64Encoded:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)!

private func makeRecipe(
  id: String, date: Date, imageUrl: String? = nil, wantToCookAt: Date? = nil,
  memo: String? = nil, tags: [TagDTO] = []
) -> RecipeDTO {
  RecipeDTO(
    id: id, originalUrl: "https://example.com/\(id)", sourceType: "web", title: id,
    imageUrl: imageUrl, servingsValue: nil, servingsRaw: nil, cookingTimeMinutes: nil, genre: nil,
    analysisStatus: .completed, wantToCookAt: wantToCookAt, memo: memo, ingredients: [], steps: [],
    tags: tags, createdAt: date, updatedAt: date)
}

private struct TestTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}

private final class StepMutationURLProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    if request.url?.host == "offline.invalid" {
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
      return
    }
    var data = request.httpBody ?? Data()
    if let stream = request.httpBodyStream {
      stream.open()
      defer { stream.close() }
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        guard count > 0 else { break }
        data.append(contentsOf: buffer[..<count])
      }
    }
    guard request.httpMethod == "PATCH",
      let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
      return
    }
    let steps = body["steps"] as? [[String: Any]] ?? [["text": "既存の手順"]]
    let json: [String: Any] = [
      "id": "step-recipe", "originalUrl": "https://example.com/step-recipe", "sourceType": "web",
      "title": body["title"] as? String ?? "", "analysisStatus": "completed",
      "ingredients": [], "tags": [],
      "steps": steps.enumerated().map { index, step in
        ["id": "step-\(index)", "text": step["text"] ?? "", "sortOrder": index]
      },
      "createdAt": "2027-01-15T08:00:00Z", "updatedAt": "2030-01-01T00:01:00Z",
    ]
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: json))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

private actor RemoteImageFetchRecorder {
  private(set) var count = 0

  func fetch(_ data: Data, delay: Duration) async -> Data {
    count += 1
    try? await Task.sleep(for: delay)
    return data
  }

  func waitUntilStarted() async {
    while count == 0 { await Task.yield() }
  }
}
