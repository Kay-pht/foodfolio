import GoogleSignIn
import SwiftUI

struct AuthView: View {
  @Environment(AppSession.self) private var session
  @State private var isLoading = false
  @State private var message: String?

  var body: some View {
    NavigationStack {
      ZStack {
        FoodfolioBackground()

        ScrollView {
          VStack(spacing: 28) {
            VStack(spacing: 14) {
              Image(systemName: "fork.knife.circle.fill")
                .font(.system(size: 64, weight: .medium))
                .foregroundStyle(FoodfolioTheme.terracotta)
                .frame(width: 92, height: 92)
                .glassEffect(.regular, in: Circle())

              VStack(spacing: 8) {
                Text("foodfolio")
                  .font(.largeTitle.bold())
                  .foregroundStyle(FoodfolioTheme.ink)
                Text("見つけたレシピを、\nわたしの定番に。")
                  .font(.title3.weight(.medium))
                  .foregroundStyle(FoodfolioTheme.secondaryInk)
                  .multilineTextAlignment(.center)
              }
            }
            .padding(.top, 48)

            VStack(spacing: 12) {
              Button {
                run { try await session.auth.signInWithApple() }
              } label: {
                HStack(spacing: 10) {
                  Image(systemName: "apple.logo")
                    .font(.title3)
                  Text("Appleで続ける")
                    .font(.body.weight(.semibold))
                }
                .foregroundStyle(FoodfolioTheme.ink)
                .frame(maxWidth: .infinity, minHeight: 52)
                .glassEffect(
                  .regular.interactive(),
                  in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("auth.apple")

              BrandedGoogleSignInButton {
                run { try await session.auth.signInWithGoogle() }
              }
              .frame(maxWidth: .infinity, minHeight: 52, maxHeight: 52)

              NavigationLink(destination: EmailAuthView()) {
                Label("メールで続ける", systemImage: "envelope")
                  .font(.body.weight(.semibold))
                  .foregroundStyle(FoodfolioTheme.ink)
                  .frame(maxWidth: .infinity, minHeight: 52)
                  .glassEffect(
                    .clear.interactive(),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                  )
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("auth.emailContinue")
            }

            if isLoading { ProgressView() }
            if let message {
              Text(message)
                .font(.subheadline)
                .foregroundStyle(FoodfolioTheme.secondaryInk)
                .multilineTextAlignment(.center)
            }

            Text("保存したレシピはオフラインでも見られます。")
              .font(.footnote)
              .foregroundStyle(FoodfolioTheme.secondaryInk)
              .padding(.top, 4)
          }
          .padding(.horizontal, 28)
          .padding(.bottom, 40)
        }
      }
      .tint(FoodfolioTheme.terracotta)
      .toolbar(.hidden, for: .navigationBar)
    }
  }

  private func run(_ action: @escaping () async throws -> Void) {
    isLoading = true
    message = nil
    Task {
      do {
        try await action()
        await session.didAuthenticate()
      } catch { message = error.localizedDescription }
      isLoading = false
    }
  }
}

private struct EmailAuthView: View {
  @Environment(AppSession.self) private var session
  @State private var email = ""
  @State private var password = ""
  @State private var isSignUp = false
  @State private var isLoading = false
  @State private var message: String?

  var body: some View {
    ZStack {
      FoodfolioBackground()

      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          VStack(alignment: .leading, spacing: 6) {
            Text(isSignUp ? "アカウントを作成" : "おかえりなさい")
              .font(.title.bold())
              .foregroundStyle(FoodfolioTheme.ink)
            Text(isSignUp ? "メールアドレスでFoodfolioを始めます。" : "メールアドレスで続けます。")
              .font(.subheadline)
              .foregroundStyle(FoodfolioTheme.secondaryInk)
          }
          .padding(.bottom, 6)

          authField(systemImage: "envelope") {
            TextField("メールアドレス", text: $email)
              .textInputAutocapitalization(.never)
              .keyboardType(.emailAddress)
              .textContentType(.emailAddress)
              .accessibilityIdentifier("auth.email")
          }

          authField(systemImage: "lock") {
            SecureField("パスワード", text: $password)
              .textContentType(isSignUp ? .newPassword : .password)
              .accessibilityIdentifier("auth.password")
          }

          Button {
            run {
              if isSignUp {
                try await session.auth.signUp(email: email, password: password)
              } else {
                try await session.auth.signIn(email: email, password: password)
              }
            }
          } label: {
            Text(isSignUp ? "新規登録" : "ログイン")
              .font(.body.weight(.semibold))
              .frame(maxWidth: .infinity, minHeight: 48)
          }
          .buttonStyle(.glassProminent)
          .tint(FoodfolioTheme.terracotta)
          .disabled(isLoading || email.isEmpty || password.isEmpty)
          .accessibilityIdentifier("auth.emailSubmit")

          HStack {
            Button(isSignUp ? "ログインへ" : "新規登録へ") { isSignUp.toggle() }
              .buttonStyle(.plain)
            Spacer()
            Button("パスワードをリセット") {
              run(refresh: false) {
                try await session.auth.resetPassword(email: email)
                message = "リセットメールを送信しました。"
              }
            }
            .buttonStyle(.plain)
            .disabled(email.isEmpty)
            .accessibilityIdentifier("auth.resetPassword")
          }
          .font(.subheadline.weight(.medium))
          .foregroundStyle(FoodfolioTheme.terracotta)

          if isLoading { ProgressView().frame(maxWidth: .infinity) }
          if let message {
            Text(message)
              .font(.subheadline)
              .foregroundStyle(FoodfolioTheme.secondaryInk)
          }
        }
        .padding(.horizontal, 24)
        .padding(.top, 28)
      }
    }
    .tint(FoodfolioTheme.terracotta)
    .toolbar(.visible, for: .navigationBar)
    .navigationTitle("メール")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func authField<Content: View>(
    systemImage: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    HStack(spacing: 12) {
      Image(systemName: systemImage)
        .frame(width: 20)
        .foregroundStyle(FoodfolioTheme.secondaryInk)
      content()
        .textFieldStyle(.plain)
    }
    .padding(.horizontal, 14)
    .frame(minHeight: 52)
    .glassEffect(
      .regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous)
    )
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

private struct BrandedGoogleSignInButton: UIViewRepresentable {
  let action: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(action: action) }

  func makeUIView(context: Context) -> GIDSignInButton {
    let button = GIDSignInButton()
    button.style = .wide
    button.colorScheme = .light
    button.accessibilityIdentifier = "auth.google"
    button.addTarget(
      context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
    return button
  }

  func updateUIView(_ uiView: GIDSignInButton, context: Context) {}

  final class Coordinator: NSObject {
    private let action: () -> Void

    init(action: @escaping () -> Void) { self.action = action }

    @objc func tapped() { action() }
  }
}
