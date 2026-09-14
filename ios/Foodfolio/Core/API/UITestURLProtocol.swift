#if DEBUG
  import Foundation

  final class UITestURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
      request.url?.host == "ui-test.foodfolio.invalid"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
      guard let url = request.url else {
        finish(status: 400, json: error("INVALID_REQUEST"))
        return
      }
      let path = url.path
      let method = request.httpMethod ?? "GET"

      switch (method, path) {
      case ("POST", "/v1/recipes"):
        finish(status: 201, json: recipe(title: "追加したレシピ"))
      case ("PATCH", "/v1/recipes/ui-added-recipe"):
        let body = requestBody()
        finish(
          status: 200,
          json: recipe(
            title: "追加したレシピ 更新",
            genre: body["genre"] as? String,
            ingredients: body["ingredients"] as? [[String: Any]] ?? [],
            tags: []))
      case ("PATCH", "/v1/recipes/ui-recipe/want-to-cook"),
        ("PATCH", "/v1/recipes/ui-added-recipe/want-to-cook"):
        if ProcessInfo.processInfo.arguments.contains("-ui-testing-want-to-cook-failure") {
          finish(status: 500, json: error("INTERNAL_ERROR"))
          return
        }
        let enabled = requestBody()["enabled"] as? Bool ?? false
        let isSeedRecipe = path.contains("/ui-recipe/")
        finish(
          status: 200,
          json: recipe(
            id: isSeedRecipe ? "ui-recipe" : "ui-added-recipe",
            title: isSeedRecipe ? "親子丼" : "追加したレシピ",
            analysisStatus: isSeedRecipe ? uiRecipeAnalysisStatus() : "completed",
            wantToCookAt: enabled ? "2026-08-28T00:00:02Z" : nil))
      case ("DELETE", "/v1/recipes/ui-added-recipe"):
        finish(status: 204)
      case ("POST", "/v1/tags"):
        finish(status: 201, json: tag())
      case ("POST", "/v1/recipes/ui-added-recipe/tags/batch"):
        if ProcessInfo.processInfo.arguments.contains("-ui-testing-slow-tag-save") {
          Thread.sleep(forTimeInterval: 3)
        }
        finish(
          status: 200,
          json: recipe(title: "追加したレシピ", tags: [existingTag(), tag()]))
      case ("POST", "/v1/recipes/ui-added-recipe/tags"):
        let tagID = requestBody()["tagId"] as? String
        let attachedTags = tagID == "ui-tag" ? [existingTag()] : [existingTag(), tag()]
        finish(status: 200, json: recipe(title: "追加したレシピ", tags: attachedTags))
      case ("DELETE", "/v1/recipes/ui-added-recipe/tags/ui-new-tag"):
        finish(status: 204)
      case ("GET", "/v1/settings"):
        finish(status: 200, json: ["recipeAnalysisNotificationEnabled": true])
      case ("PATCH", "/v1/settings"):
        finish(
          status: 200,
          json: [
            "recipeAnalysisNotificationEnabled":
              requestBody()["recipeAnalysisNotificationEnabled"] as? Bool ?? true
          ])
      case ("DELETE", "/v1/me"):
        finish(status: 204)
      default:
        finish(status: 404, json: error("NOT_FOUND"))
      }
    }

    override func stopLoading() {}

    private func requestBody() -> [String: Any] {
      guard let data = request.httpBody,
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { return [:] }
      return object
    }

    private func recipe(
      id: String = "ui-added-recipe", title: String, genre: String? = "主菜",
      ingredients: [[String: Any]] = [], tags: [[String: Any]] = [],
      analysisStatus: String = "completed", wantToCookAt: String? = nil
    ) -> [String: Any] {
      [
        "id": id,
        "originalUrl": "https://example.com/new-recipe",
        "sourceType": "web",
        "title": title,
        "imageUrl": NSNull(),
        "servingsValue": 2,
        "servingsRaw": "2人分",
        "cookingTimeMinutes": 15,
        "genre": genre ?? NSNull(),
        "analysisStatus": analysisStatus,
        "wantToCookAt": wantToCookAt ?? NSNull(),
        "ingredients": ingredients.enumerated().map { index, item in
          [
            "id": "ui-added-ingredient-\(index)",
            "name": item["name"] as? String ?? "材料",
            "amount": item["amount"] ?? NSNull(),
            "sortOrder": index,
          ]
        },
        "steps": [],
        "tags": tags,
        "createdAt": "2026-08-28T00:00:00Z",
        "updatedAt": "2026-08-28T00:00:01Z",
      ]
    }

    private func uiRecipeAnalysisStatus() -> String {
      let arguments = ProcessInfo.processInfo.arguments
      if arguments.contains("-ui-testing-status-pending") { return "pending" }
      if arguments.contains("-ui-testing-status-processing") { return "processing" }
      if arguments.contains("-ui-testing-status-failed") { return "failed" }
      return "completed"
    }

    private func existingTag() -> [String: Any] {
      [
        "id": "ui-tag",
        "name": "簡単",
        "createdAt": "2026-08-27T00:00:00Z",
      ]
    }

    private func tag() -> [String: Any] {
      [
        "id": "ui-new-tag",
        "name": "新規タグ",
        "createdAt": "2026-08-28T00:00:00Z",
      ]
    }

    private func error(_ code: String) -> [String: Any] {
      ["error": ["code": code, "message": code, "requestId": "ui-test"]]
    }

    private func finish(status: Int, json: [String: Any]? = nil) {
      guard let url = request.url,
        let response = HTTPURLResponse(
          url: url, statusCode: status, httpVersion: "HTTP/1.1",
          headerFields: ["Content-Type": "application/json"])
      else { return }
      let data = json.flatMap { try? JSONSerialization.data(withJSONObject: $0) } ?? Data()
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      if !data.isEmpty { client?.urlProtocol(self, didLoad: data) }
      client?.urlProtocolDidFinishLoading(self)
    }
  }
#endif
