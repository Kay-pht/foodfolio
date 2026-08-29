import GoogleSignIn
import SwiftUI
import UIKit

private enum AuthMethodButtonMetrics {
  static let height: CGFloat = 52
  static let cornerRadius: CGFloat = 26
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
    .background(Color.white, in: Capsule())
    .overlay {
      Capsule()
        .stroke(FoodfolioTheme.ink.opacity(0.58), lineWidth: 1)
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

private struct GoogleSignInLogo: UIViewRepresentable {
  func makeUIView(context: Context) -> GoogleSignInLogoView {
    GoogleSignInLogoView()
  }

  func updateUIView(_ uiView: GoogleSignInLogoView, context: Context) {}
}

private final class GoogleSignInLogoView: UIView {
  private let button = GIDSignInButton()

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    clipsToBounds = true
    isUserInteractionEnabled = false
    isAccessibilityElement = false

    button.style = .iconOnly
    button.colorScheme = .light
    button.isUserInteractionEnabled = false
    button.accessibilityElementsHidden = true
    addSubview(button)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()

    // GIDSignInButton renders the official multicolor G at roughly (9, 10), 29x30
    // inside its 48pt icon-only control. Offset the control so only that branded mark
    // is visible; the surrounding capsule and text are rendered consistently in SwiftUI.
    button.frame = CGRect(x: -7, y: -8, width: 48, height: 48)
  }
}
