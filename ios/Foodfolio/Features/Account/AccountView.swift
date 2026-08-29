import SwiftUI

struct AccountView: View {
  @Environment(AppSession.self) private var session
  @State private var showLogout = false
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
        Button("ログアウト") { showLogout = true }
          .disabled(isWorking)
          .accessibilityIdentifier("account.logout")
        Button("アカウント削除", role: .destructive) { showDelete = true }
          .disabled(isWorking)
          .accessibilityIdentifier("account.delete")
      }
      if isWorking { ProgressView() }
      if let error { Text(error).foregroundStyle(.red) }
    }
    .navigationTitle("アカウント")
    .alert("ログアウト", isPresented: $showLogout) {
      Button("キャンセル", role: .cancel) {}
      Button("ログアウト", role: .destructive) { logout() }
    } message: {
      Text("ログアウトしますか？")
    }
    .alert("アカウント削除", isPresented: $showDelete) {
      Button("キャンセル", role: .cancel) {}
      Button("完全に削除", role: .destructive) { deleteAccount() }
    } message: {
      Text("アカウントとすべてのデータを完全に削除しますか？")
    }
  }

  private func logout() {
    isWorking = true
    Task {
      defer { isWorking = false }
      do {
        try await session.logout()
      } catch {
        self.error = error.localizedDescription
      }
    }
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
