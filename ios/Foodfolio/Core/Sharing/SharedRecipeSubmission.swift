import Foundation

enum SharedRecipeSubmissionFailure: Error, Equatable, LocalizedError {
  case unauthenticated
  case duplicateRecipe
  case analysisLimitExceeded
  case invalidRequest
  case transport
  case server

  var errorDescription: String? {
    switch self {
    case .unauthenticated:
      "Foodfolioアプリで再度ログインしてください。"
    case .duplicateRecipe:
      "このレシピはすでに保存されています。"
    case .analysisLimitExceeded:
      "解析受付の上限に達しています。"
    case .invalidRequest:
      "有効なレシピURLを共有してください。"
    case .transport:
      "通信できませんでした。接続を確認してもう一度お試しください。"
    case .server:
      "追加に失敗しました。"
    }
  }

  var isRetryable: Bool {
    switch self {
    case .transport, .server:
      true
    case .unauthenticated, .duplicateRecipe, .analysisLimitExceeded, .invalidRequest:
      false
    }
  }
}

enum SharedRecipeSubmissionResponse {
  private struct ErrorEnvelope: Decodable {
    struct Payload: Decodable {
      let code: String
    }

    let error: Payload
  }

  static func validate(statusCode: Int, data: Data) throws {
    guard !(200..<300).contains(statusCode) else { return }

    let code = try? JSONDecoder().decode(ErrorEnvelope.self, from: data).error.code
    switch code {
    case "DUPLICATE_RECIPE":
      throw SharedRecipeSubmissionFailure.duplicateRecipe
    case "ANALYSIS_LIMIT_EXCEEDED":
      throw SharedRecipeSubmissionFailure.analysisLimitExceeded
    case "UNAUTHENTICATED":
      throw SharedRecipeSubmissionFailure.unauthenticated
    case "INVALID_URL", "VALIDATION_ERROR", "INVALID_REQUEST":
      throw SharedRecipeSubmissionFailure.invalidRequest
    default:
      switch statusCode {
      case 401:
        throw SharedRecipeSubmissionFailure.unauthenticated
      case 409:
        throw SharedRecipeSubmissionFailure.duplicateRecipe
      case 429:
        throw SharedRecipeSubmissionFailure.analysisLimitExceeded
      case 400..<500:
        throw SharedRecipeSubmissionFailure.invalidRequest
      default:
        throw SharedRecipeSubmissionFailure.server
      }
    }
  }
}

enum SharedRecipeAPI {
  private struct RequestBody: Encodable { let url: String }

  static func add(url: URL, token: String, session: URLSession = .shared) async throws {
    guard let baseURLString = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
      let baseURL = URL(string: baseURLString),
      let endpoint = URL(string: "/v1/recipes", relativeTo: baseURL)
    else {
      throw SharedRecipeSubmissionFailure.server
    }

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(RequestBody(url: url.absoluteString))

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw SharedRecipeSubmissionFailure.transport
    }

    guard let httpResponse = response as? HTTPURLResponse else {
      throw SharedRecipeSubmissionFailure.server
    }
    try SharedRecipeSubmissionResponse.validate(
      statusCode: httpResponse.statusCode,
      data: data)
  }
}
