import SwiftUI

struct AccountView: View {
  @Environment(AppSession.self) private var session
  @State private var showDelete = false
  @State private var isWorking = false
  @State private var error: String?
  var body: some View {
    Form {
      Section("email") {
        Text(session.user?.email ?? "メールアドレスなし")
          .accessibilityIdentifier("account.email")
      }
      Section {
        Button("ログアウト") {
          Task {
            do { try await session.logout() } catch { self.error = error.localizedDescription }
          }
        }.accessibilityIdentifier("account.logout")
        Button("アカウント削除", role: .destructive) { showDelete = true }.accessibilityIdentifier(
          "account.delete")
      }
      if isWorking { ProgressView() }
      if let error { Text(error).foregroundStyle(.red) }
    }.navigationTitle("アカウント").confirmationDialog(
      "アカウントとすべてのデータを完全に削除しますか？", isPresented: $showDelete
    ) { Button("完全に削除", role: .destructive) { deleteAccount() } }
  }
  private func deleteAccount() {
    isWorking = true
    Task {
      do {
        let cleaner = SessionCleaner(session: session)
        let service = AccountDeletionService(
          auth: session.auth, backend: APIAccountBackend(api: session.api), cleaner: cleaner)
        try await service.deleteAccount()
        session.refreshUser()
      } catch { self.error = error.localizedDescription }
      isWorking = false
    }
  }
}

@MainActor private struct SessionCleaner: LocalDataCleaner {
  let session: AppSession
  func clear() async throws {
    try await session.repository.clearLocalData()
    session.syncService.clearMetadata()
    session.history.removeAll()
  }
}
