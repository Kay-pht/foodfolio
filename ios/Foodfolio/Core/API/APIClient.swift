import Foundation

protocol IDTokenProvider: Sendable { func idToken() async throws -> String }

actor APIClient {
  let baseURL: URL
  private let tokenProvider: IDTokenProvider
  private let session: URLSession
  private let decoder: JSONDecoder
  private let encoder: JSONEncoder

  init(baseURL: URL, tokenProvider: IDTokenProvider, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.session = session
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    self.decoder = decoder
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    self.encoder = encoder
  }

  func get<Response: Decodable & Sendable>(_ path: String) async throws -> Response {
    try await request(path, method: "GET", body: Optional<String>.none)
  }
  func send<Body: Encodable & Sendable, Response: Decodable & Sendable>(
    _ path: String, method: String, body: Body
  ) async throws -> Response { try await request(path, method: method, body: body) }
  func sendWithoutResponse<Body: Encodable & Sendable>(_ path: String, method: String, body: Body?)
    async throws
  { let _: EmptyResponse = try await request(path, method: method, body: body) }

  private func request<Body: Encodable & Sendable, Response: Decodable & Sendable>(
    _ path: String, method: String, body: Body?
  ) async throws -> Response {
    guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.invalidURL }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue(
      "Bearer \(try await tokenProvider.idToken())", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let body { request.httpBody = try encoder.encode(body) }
    let data: Data
    let response: URLResponse
    do { (data, response) = try await session.data(for: request) } catch { throw APIError.offline }
    guard let http = response as? HTTPURLResponse else { throw APIError.server }
    guard (200..<300).contains(http.statusCode) else {
      throw mapError(status: http.statusCode, data: data)
    }
    if Response.self == EmptyResponse.self { return EmptyResponse() as! Response }
    do { return try decoder.decode(Response.self, from: data) } catch { throw APIError.decoding }
  }

  private func mapError(status: Int, data: Data) -> APIError {
    let payload = try? decoder.decode(APIErrorEnvelope.self, from: data).error
    switch payload?.code {
    case "UNAUTHENTICATED": return .unauthenticated
    case "INVALID_URL": return .invalidURL
    case "DUPLICATE_RECIPE": return .duplicateRecipe(payload?.details?["recipeId"])
    case "RECIPE_ANALYSIS_IN_PROGRESS": return .analysisInProgress
    case "NOT_FOUND": return .notFound
    case "VALIDATION_ERROR", "INVALID_REQUEST": return .validation
    default: return status == 401 ? .unauthenticated : .server
    }
  }
}

private struct EmptyResponse: Codable, Sendable {}
