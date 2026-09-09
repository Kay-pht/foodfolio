import Foundation
import OSLog

protocol IDTokenProvider: Sendable { func idToken() async throws -> String }

actor APIClient {
  private static let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "com.keyukt.foodfolio", category: "APIClient")

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
  func send<Response: Decodable & Sendable>(_ path: String, method: String) async throws -> Response {
    try await request(path, method: method, body: Optional<String>.none)
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
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try encoder.encode(body)
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch let error as URLError {
      let requestPath = url.path
      if error.code == .cancelled {
        Self.logger.debug(
          "Request cancelled method=\(method, privacy: .public) path=\(requestPath, privacy: .public) code=\(error.errorCode, privacy: .public)"
        )
        throw CancellationError()
      }

      Self.logger.error(
        "Request failed method=\(method, privacy: .public) path=\(requestPath, privacy: .public) code=\(error.errorCode, privacy: .public)"
      )
      switch error.code {
      case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed,
        .internationalRoamingOff:
        throw APIError.offline
      default:
        throw APIError.server
      }
    } catch is CancellationError {
      Self.logger.debug(
        "Request cancelled method=\(method, privacy: .public) path=\(url.path, privacy: .public)"
      )
      throw CancellationError()
    } catch {
      Self.logger.error(
        "Request failed method=\(method, privacy: .public) path=\(url.path, privacy: .public) errorType=\(String(describing: type(of: error)), privacy: .public)"
      )
      throw APIError.server
    }
    guard let http = response as? HTTPURLResponse else { throw APIError.server }
    guard (200..<300).contains(http.statusCode) else {
      throw APIError.from(status: http.statusCode, data: data)
    }
    if Response.self == EmptyResponse.self { return EmptyResponse() as! Response }
    do { return try decoder.decode(Response.self, from: data) } catch { throw APIError.decoding }
  }

}

private struct EmptyResponse: Codable, Sendable {}
