import AuthenticationServices
import GoogleSignIn
import SwiftUI
import UIKit

private enum AuthMethodButtonMetrics {
  static let height: CGFloat = 52
  static let cornerRadius: CGFloat = height / 2
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
              BrandedAppleSignInButton {
                run { try await session.auth.signInWithApple() }
              }
              .frame(maxWidth: .infinity)
              .frame(height: AuthMethodButtonMetrics.height)

              BrandedGoogleSignInButton {
                run { try await session.auth.signInWithGoogle() }
              }

              NavigationLink(destination: EmailAuthView()) {
                Label("メールで続ける", systemImage: "envelope")
                  .font(.body.weight(.semibold))
                  .foregroundStyle(FoodfolioTheme.ink)
                  .frame(maxWidth: .infinity)
                  .frame(height: AuthMethodButtonMetrics.height)
                  .background(Color.white, in: Capsule())
                  .overlay {
                    Capsule()
                      .stroke(FoodfolioTheme.ink.opacity(0.22), lineWidth: 1)
                  }
                  .contentShape(Capsule())
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

private struct BrandedAppleSignInButton: UIViewRepresentable {
  let action: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(action: action) }

  func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
    let button = ASAuthorizationAppleIDButton(type: .continue, style: .whiteOutline)
    button.cornerRadius = AuthMethodButtonMetrics.cornerRadius
    button.accessibilityIdentifier = "auth.apple"
    button.addTarget(
      context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
    return button
  }

  func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {
    uiView.cornerRadius = AuthMethodButtonMetrics.cornerRadius
  }

  final class Coordinator: NSObject {
    private let action: () -> Void

    init(action: @escaping () -> Void) { self.action = action }

    @objc func tapped() { action() }
  }
}

private struct BrandedGoogleSignInButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      ZStack {
        Capsule()
          .fill(Color.white)
        Capsule()
          .stroke(googleBorderColor, lineWidth: 1)
        GoogleSignInButtonContent()
          .allowsHitTesting(false)
      }
      .frame(maxWidth: .infinity)
      .frame(height: AuthMethodButtonMetrics.height)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("auth.google")
  }

  private var googleBorderColor: Color {
    Color(red: 116.0 / 255.0, green: 119.0 / 255.0, blue: 117.0 / 255.0)
  }
}

private struct GoogleSignInButtonContent: UIViewRepresentable {
  func makeUIView(context: Context) -> GoogleSignInButtonContentView {
    GoogleSignInButtonContentView()
  }

  func updateUIView(_ uiView: GoogleSignInButtonContentView, context: Context) {}
}

private final class GoogleSignInButtonContentView: UIView {
  private let button = GIDSignInButton()

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isUserInteractionEnabled = false
    isAccessibilityElement = false

    button.style = .wide
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

    let fittingSize = button.sizeThatFits(CGSize(width: 0, height: 48))
    let contentWidth = min(bounds.width, fittingSize.width)
    button.frame = CGRect(
      x: (bounds.width - contentWidth) / 2,
      y: (bounds.height - 48) / 2,
      width: contentWidth,
      height: 48
    )

    let mask = CAShapeLayer()
    mask.frame = button.bounds
    mask.path = UIBezierPath(rect: button.bounds.insetBy(dx: 6, dy: 6)).cgPath
    button.layer.mask = mask
  }
}
