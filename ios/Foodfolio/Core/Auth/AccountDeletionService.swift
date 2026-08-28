import Foundation

@MainActor protocol LocalDataCleaner { func clear() async throws }
@MainActor protocol AccountBackend { func deleteAccount() async throws }

@MainActor final class AccountDeletionService {
  private let auth: AuthService
  private let backend: AccountBackend
  private let cleaner: LocalDataCleaner
  init(auth: AuthService, backend: AccountBackend, cleaner: LocalDataCleaner) {
    self.auth = auth
    self.backend = backend
    self.cleaner = cleaner
  }
  func deleteAccount() async throws {
    if auth.currentUser?.providers.contains("apple.com") == true {
      try await auth.revokeAppleToken()
    }
    try await backend.deleteAccount()
    try auth.signOut()
    try await cleaner.clear()
  }
}

struct APIAccountBackend: AccountBackend {
  let api: APIClient
  func deleteAccount() async throws {
    try await api.sendWithoutResponse("/v1/me", method: "DELETE", body: Optional<String>.none)
  }
}
