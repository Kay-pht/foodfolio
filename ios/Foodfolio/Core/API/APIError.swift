import Foundation

struct APIErrorEnvelope: Decodable {
  struct Payload: Decodable {
    let code: String
    let message: String
    let details: [String: String]?
    let requestId: String
  }
  let error: Payload
}

enum APIError: Error, Equatable {
  case unauthenticated, invalidURL
  case duplicateRecipe(String?)
  case analysisInProgress, aiConsentRequired, notFound, validation, offline, server, decoding

  static func from(status: Int, data: Data) -> APIError {
    let payload = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data).error
    switch payload?.code {
    case "UNAUTHENTICATED": return .unauthenticated
    case "INVALID_URL": return .invalidURL
    case "DUPLICATE_RECIPE": return .duplicateRecipe(payload?.details?["recipeId"])
    case "RECIPE_ANALYSIS_IN_PROGRESS": return .analysisInProgress
    case "AI_CONSENT_REQUIRED": return .aiConsentRequired
    case "NOT_FOUND": return .notFound
    case "VALIDATION_ERROR", "INVALID_REQUEST": return .validation
    default: return status == 401 ? .unauthenticated : .server
    }
  }

  var userMessage: String {
    switch self {
    case .unauthenticated: "再度ログインしてください。"
    case .invalidURL: "有効なURLを入力してください。"
    case .duplicateRecipe: "このレシピはすでに保存されています。"
    case .analysisInProgress: "解析中は編集できません。"
    case .aiConsentRequired: "AI解析への同意を確認してください。"
    case .notFound: "対象が見つかりませんでした。"
    case .validation: "入力内容を確認してください。"
    case .offline: "この操作にはインターネット接続が必要です。"
    case .server, .decoding: "通信に失敗しました。もう一度お試しください。"
    }
  }
}
