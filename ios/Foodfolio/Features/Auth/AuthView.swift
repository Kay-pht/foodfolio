import SwiftUI

struct AuthView: View {
  @Environment(AppSession.self) private var session
  @State private var email = ""
  @State private var password = ""
  @State private var isSignUp = false
  @State private var isLoading = false
  @State private var message: String?

  var body: some View {
    NavigationStack {
      Form {
        Section { Text("Foodfolio").font(.largeTitle.bold()).frame(maxWidth: .infinity) }
        Section {
          Button("Appleで続ける") { run { try await session.auth.signInWithApple() } }
            .accessibilityIdentifier("auth.apple")
          Button("Googleで続ける") { run { try await session.auth.signInWithGoogle() } }
            .accessibilityIdentifier("auth.google")
        }
        Section("メールで続ける") {
          TextField("メールアドレス", text: $email).textInputAutocapitalization(.never).keyboardType(
            .emailAddress
          ).accessibilityIdentifier("auth.email")
          SecureField("パスワード", text: $password).accessibilityIdentifier("auth.password")
          Button(isSignUp ? "新規登録" : "ログイン") {
            run {
              if isSignUp {
                try await session.auth.signUp(email: email, password: password)
              } else {
                try await session.auth.signIn(email: email, password: password)
              }
            }
          }.accessibilityIdentifier("auth.emailSubmit")
          Button(isSignUp ? "ログインへ" : "新規登録へ") { isSignUp.toggle() }.buttonStyle(.plain)
          Button("パスワードをリセット") {
            run(refresh: false) {
              try await session.auth.resetPassword(email: email)
              message = "リセットメールを送信しました。"
            }
          }.disabled(email.isEmpty).accessibilityIdentifier("auth.resetPassword")
        }
        if isLoading { ProgressView().frame(maxWidth: .infinity) }
        if let message { Text(message).foregroundStyle(.secondary) }
      }
    }
  }

  private func run(refresh: Bool = true, _ action: @escaping () async throws -> Void) {
    isLoading = true
    message = nil
    Task {
      do {
        try await action()
        if refresh { await session.didAuthenticate() }
      } catch { message = error.localizedDescription }
      isLoading = false
    }
  }
}
