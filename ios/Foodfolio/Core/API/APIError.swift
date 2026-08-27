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
  case analysisInProgress, notFound, validation, offline, server, decoding

  var userMessage: String {
    switch self {
    case .unauthenticated: "再度ログインしてください。"
    case .invalidURL: "有効なURLを入力してください。"
    case .duplicateRecipe: "このレシピはすでに保存されています。"
    case .analysisInProgress: "解析中は編集できません。"
    case .notFound: "対象が見つかりませんでした。"
    case .validation: "入力内容を確認してください。"
    case .offline: "この操作にはインターネット接続が必要です。"
    case .server, .decoding: "通信に失敗しました。もう一度お試しください。"
    }
  }
}
