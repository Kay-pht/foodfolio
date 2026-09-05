import AuthenticationServices
import CryptoKit
import FirebaseAuth
import FirebaseCore
import GoogleSignIn
import UIKit

struct AuthenticatedUser: Equatable, Sendable {
  let uid: String
  let email: String?
  let providers: [String]
}

enum SharedAuthentication {
  static let accessGroup = "group.com.keyukt.foodfolio"

  @MainActor
  static func configure() throws {
    let auth = Auth.auth()
    let existingUser = auth.currentUser
    let storedSharedUser = try auth.getStoredUser(forAccessGroup: accessGroup)
    try auth.useUserAccessGroup(accessGroup)

    guard storedSharedUser == nil, let existingUser else { return }
    auth.updateCurrentUser(existingUser) { error in
      if let error {
        assertionFailure("Unable to migrate Firebase Auth to shared storage: \(error.localizedDescription)")
      }
    }
  }
}

@MainActor protocol AuthService: AnyObject {
  var currentUser: AuthenticatedUser? { get }
  func signIn(email: String, password: String) async throws
  func signUp(email: String, password: String) async throws
  func resetPassword(email: String) async throws
  func signInWithGoogle() async throws
  func signInWithApple() async throws
  func revokeAppleToken() async throws
  func signOut() throws
}

@MainActor final class FirebaseAuthService: AuthService {
  var currentUser: AuthenticatedUser? {
    guard let user = Auth.auth().currentUser else { return nil }
    return AuthenticatedUser(
      uid: user.uid, email: user.email, providers: user.providerData.map(\.providerID))
  }
  func signIn(email: String, password: String) async throws {
    _ = try await Auth.auth().signIn(withEmail: email, password: password)
  }
  func signUp(email: String, password: String) async throws {
    _ = try await Auth.auth().createUser(withEmail: email, password: password)
  }
  func resetPassword(email: String) async throws {
    try await Auth.auth().sendPasswordReset(withEmail: email)
  }
  func signInWithGoogle() async throws {
    guard let clientID = FirebaseApp.app()?.options.clientID,
      let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
      let controller = scene.windows.first(where: \.isKeyWindow)?.rootViewController
    else { throw APIError.server }
    GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
    let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: controller)
    guard let idToken = result.user.idToken?.tokenString else { throw APIError.unauthenticated }
    let credential = GoogleAuthProvider.credential(
      withIDToken: idToken, accessToken: result.user.accessToken.tokenString)
    _ = try await Auth.auth().signIn(with: credential)
  }
  func signInWithApple() async throws {
    let result = try await AppleAuthorizationCoordinator().authorize()
    let credential = OAuthProvider.appleCredential(
      withIDToken: result.idToken, rawNonce: result.rawNonce, fullName: result.fullName)
    _ = try await Auth.auth().signIn(with: credential)
  }
  func revokeAppleToken() async throws {
    let result = try await AppleAuthorizationCoordinator().authorize()
    try await Auth.auth().revokeToken(withAuthorizationCode: result.authorizationCode)
  }
  func signOut() throws {
    try Auth.auth().signOut()
    GIDSignIn.sharedInstance.signOut()
  }
}

struct FirebaseTokenProvider: IDTokenProvider {
  func idToken() async throws -> String {
    guard let user = Auth.auth().currentUser else { throw APIError.unauthenticated }
    return try await user.getIDToken()
  }
}

private final class AppleAuthorizationCoordinator: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  struct Result {
    let idToken: String
    let authorizationCode: String
    let rawNonce: String
    let fullName: PersonNameComponents?
  }
  private var continuation: CheckedContinuation<Result, Error>?
  private var rawNonce = ""

  @MainActor func authorize() async throws -> Result {
    rawNonce = Self.randomNonce()
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.email, .fullName]
    request.nonce = Self.sha256(rawNonce)
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    return try await withCheckedThrowingContinuation {
      continuation = $0
      controller.performRequests()
    }
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else {
      fatalError("No active window scene")
    }
    return scene.windows.first(where: \.isKeyWindow) ?? ASPresentationAnchor(windowScene: scene)
  }
  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
      let tokenData = credential.identityToken,
      let idToken = String(data: tokenData, encoding: .utf8),
      let codeData = credential.authorizationCode,
      let code = String(data: codeData, encoding: .utf8)
    else {
      continuation?.resume(throwing: APIError.unauthenticated)
      continuation = nil
      return
    }
    continuation?.resume(
      returning: Result(
        idToken: idToken, authorizationCode: code, rawNonce: rawNonce, fullName: credential.fullName
      ))
    continuation = nil
  }
  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithError error: Error
  ) {
    continuation?.resume(throwing: error)
    continuation = nil
  }
  private static func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  private static func randomNonce(length: Int = 32) -> String {
    let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    return String((0..<length).map { _ in charset.randomElement()! })
  }
}
