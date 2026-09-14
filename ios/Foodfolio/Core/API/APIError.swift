import Foundation

struct APIErrorEnvelope: Decodable {
  struct Payload: Decodable {
    struct Details: Decodable {
      let recipeId: String?
      let limitType: String?
      let limit: Int?
    }

    let code: String
    let message: String
    let details: Details?
    let requestId: String
  }
  let error: Payload
}

enum AnalysisLimitType: String, Equatable {
  case userOutstanding = "user_outstanding"
  case userDaily = "user_daily"
  case userMonthly = "user_monthly"
  case globalOutstanding = "global_outstanding"
  case globalDaily = "global_daily"
}

enum APIError: LocalizedError, Equatable {
  case unauthenticated, invalidURL
  case duplicateRecipe(String?)
  case analysisLimitExceeded(AnalysisLimitType, Int?)
  case analysisInProgress, notFound, validation, offline, server, decoding

  static func from(status: Int, data: Data) -> APIError {
    let payload = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data).error
    switch payload?.code {
    case "UNAUTHENTICATED": return .unauthenticated
    case "INVALID_URL": return .invalidURL
    case "DUPLICATE_RECIPE": return .duplicateRecipe(payload?.details?.recipeId)
    case "ANALYSIS_LIMIT_EXCEEDED":
      guard let typeValue = payload?.details?.limitType,
        let type = AnalysisLimitType(rawValue: typeValue)
      else { return .server }
      return .analysisLimitExceeded(type, payload?.details?.limit)
    case "RECIPE_ANALYSIS_IN_PROGRESS": return .analysisInProgress
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
    case .analysisLimitExceeded(let type, let limit):
      switch type {
      case .userOutstanding:
        "解析待ちのレシピが\(limit ?? 10)件あります。いずれかの解析が完了してから、もう一度お試しください。"
      case .userDaily:
        "本日のレシピ解析上限（\(limit ?? 30)件）に達しました。明日0:00以降にもう一度お試しください。"
      case .userMonthly:
        "今月のレシピ解析上限（\(limit ?? 100)件）に達しました。来月1日0:00以降にもう一度お試しください。"
      case .globalOutstanding:
        "現在、レシピ解析が混み合っています。しばらくしてからもう一度お試しください。"
      case .globalDaily:
        "本日のレシピ解析受付上限に達しました。明日0:00以降にもう一度お試しください。"
      }
    case .analysisInProgress: "解析中は編集できません。"
    case .notFound: "対象が見つかりませんでした。"
    case .validation: "入力内容を確認してください。"
    case .offline: "この操作にはインターネット接続が必要です。"
    case .server, .decoding: "通信に失敗しました。もう一度お試しください。"
    }
  }

  var errorDescription: String? { userMessage }
}
