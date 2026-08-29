import GoogleSignIn
import SwiftUI
import UIKit

private enum AuthMethodButtonMetrics {
  static let height: CGFloat = 52
}

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
                .background(FoodfolioTheme.surface.opacity(0.94), in: Circle())
                .overlay {
                  Circle()
                    .stroke(FoodfolioTheme.hairline, lineWidth: 1)
                }

              VStack(spacing: 8) {
                Text("foodfolio")
                  .font(.largeTitle.weight(.bold))
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
                AuthMethodButtonLabel(title: "Appleでサインイン") {
                  Image(systemName: "apple.logo")
                    .font(.system(size: 19, weight: .semibold))
                }
              }
              .buttonStyle(.plain)
              .accessibilityLabel("Appleでサインイン")
              .accessibilityIdentifier("auth.apple")

              Button {
                run { try await session.auth.signInWithGoogle() }
              } label: {
                AuthMethodButtonLabel(title: "Googleでサインイン") {
                  GoogleSignInLogo()
                    .frame(width: 24, height: 24)
                }
              }
              .buttonStyle(.plain)
              .accessibilityLabel("Googleでサインイン")
              .accessibilityIdentifier("auth.google")

              NavigationLink(destination: EmailAuthView()) {
                AuthMethodButtonLabel(title: "メールで続ける") {
                  Image(systemName: "envelope")
                    .font(.system(size: 18, weight: .medium))
                }
              }
              .buttonStyle(.plain)
              .accessibilityLabel("メールで続ける")
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

private struct AuthMethodButtonLabel<Icon: View>: View {
  let title: String
  let icon: Icon

  init(title: String, @ViewBuilder icon: () -> Icon) {
    self.title = title
    self.icon = icon()
  }

  var body: some View {
    HStack(spacing: 12) {
      icon
        .frame(width: 24, height: 24)

      Text(title)
        .font(.body.weight(.semibold))
    }
    .foregroundStyle(FoodfolioTheme.ink)
    .frame(maxWidth: .infinity)
    .frame(height: AuthMethodButtonMetrics.height)
    .background(FoodfolioTheme.surface.opacity(0.96), in: Capsule())
    .overlay {
      Capsule()
        .stroke(FoodfolioTheme.hairline, lineWidth: 1)
    }
    .contentShape(Capsule())
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
              .font(.title.weight(.semibold))
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
    .background(
      FoodfolioTheme.surface.opacity(0.94),
      in: RoundedRectangle(cornerRadius: 16, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(FoodfolioTheme.hairline, lineWidth: 1)
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

private struct GoogleSignInLogo: UIViewRepresentable {
  func makeUIView(context: Context) -> GoogleSignInLogoImageView {
    GoogleSignInLogoImageView(frame: .zero)
  }

  func updateUIView(_ uiView: GoogleSignInLogoImageView, context: Context) {}
}

private final class GoogleSignInLogoImageView: UIImageView {
  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    contentMode = .scaleAspectFit
    isUserInteractionEnabled = false
    isAccessibilityElement = false

    let sourceButton = GIDSignInButton()
    sourceButton.style = .iconOnly
    sourceButton.colorScheme = .light
    image = sourceButton.subviews.compactMap { $0 as? UIImageView }.first?.image
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}
