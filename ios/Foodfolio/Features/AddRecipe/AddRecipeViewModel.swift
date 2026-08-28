import Foundation
import Observation

@MainActor @Observable
final class AddRecipeViewModel {
  var url = ""
  var isSubmitting = false
  var errorMessage: String?

  var canSubmit: Bool {
    guard let value = URL(string: url), let scheme = value.scheme?.lowercased() else {
      return false
    }
    return scheme == "http" || scheme == "https"
  }

  func submit(add: (String) async throws -> Void) async -> Bool {
    guard canSubmit else {
      errorMessage = APIError.invalidURL.userMessage
      return false
    }
    isSubmitting = true
    errorMessage = nil
    defer { isSubmitting = false }
    do {
      try await add(url)
      return true
    } catch {
      errorMessage = (error as? APIError)?.userMessage ?? error.localizedDescription
      return false
    }
  }
}
