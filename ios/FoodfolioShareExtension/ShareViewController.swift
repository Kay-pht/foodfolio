import FirebaseAuth
import FirebaseCore
import Foundation
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
  private enum State {
    case loading
    case success
    case failure(String)
  }

  private var state: State = .loading {
    didSet { updateUI() }
  }
  private var didStart = false

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Foodfolio"
    placeholder = "レシピを追加中…"
    textView.isEditable = false
    textView.text = "レシピを追加中…"
    navigationItem.leftBarButtonItem = nil
    navigationItem.rightBarButtonItem = nil
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didStart else { return }
    didStart = true
    Task { @MainActor in
      await saveSharedRecipe()
    }
  }

  override func isContentValid() -> Bool { true }

  override func didSelectPost() {}

  private func saveSharedRecipe() async {
    do {
      guard
        let url = try await SharedURLExtractor.firstURL(from: extensionContext?.inputItems ?? [])
      else {
        throw ShareExtensionError.urlNotFound
      }
      guard SharedAIConsent.isGranted else {
        throw ShareExtensionError.aiConsentRequired
      }
      try configureFirebaseIfNeeded()
      guard let user = Auth.auth().currentUser else {
        throw ShareExtensionError.loginRequired
      }
      let token = try await user.getIDToken()
      try await SharedRecipeAPI.add(url: url, token: token)
      state = .success
      try? await Task.sleep(for: .milliseconds(700))
      extensionContext?.completeRequest(returningItems: nil)
    } catch {
      let fallback = "レシピの追加に失敗しました。"
      state = .failure((error as? LocalizedError)?.errorDescription ?? fallback)
    }
  }

  private func configureFirebaseIfNeeded() throws {
    if FirebaseApp.app() == nil {
      guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
        let options = FirebaseOptions(contentsOfFile: path)
      else {
        throw ShareExtensionError.configurationMissing
      }
      FirebaseApp.configure(options: options)
    }
    try Auth.auth().useUserAccessGroup("group.com.keyukt.foodfolio")
  }

  private func updateUI() {
    switch state {
    case .loading:
      textView.text = "レシピを追加中…"
    case .success:
      textView.text = "追加しました"
    case .failure(let message):
      textView.text = message
      navigationItem.leftBarButtonItem = UIBarButtonItem(
        barButtonSystemItem: .close,
        target: self,
        action: #selector(closeExtension))
    }
  }

  @objc private func closeExtension() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}

enum ShareExtensionError: LocalizedError {
  case urlNotFound
  case loginRequired
  case aiConsentRequired
  case configurationMissing
  case invalidResponse

  var errorDescription: String? {
    switch self {
    case .urlNotFound:
      "URLを取得できませんでした。"
    case .loginRequired:
      "Foodfolioアプリでログインしてください。"
    case .aiConsentRequired:
      "FoodfolioアプリでAI解析への同意を行ってください。"
    case .configurationMissing:
      "Foodfolioの共有機能を初期化できませんでした。"
    case .invalidResponse:
      "レシピの追加に失敗しました。"
    }
  }
}

enum SharedAIConsent {
  static var isGranted: Bool {
    guard let defaults = UserDefaults(suiteName: "group.com.keyukt.foodfolio"),
      let saved = defaults.dictionary(forKey: "aiProcessingConsent"),
      saved["consentedAt"] as? Date != nil,
      saved["serverSynchronized"] as? Bool == true
    else { return false }
    return true
  }
}

enum SharedURLExtractor {
  static func firstURL(from inputItems: [Any]) async throws -> URL? {
    for case let item as NSExtensionItem in inputItems {
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
          let value = try await load(provider, typeIdentifier: UTType.url.identifier)
        {
          if let url = value as? URL, SharedURLParser.isHTTPURL(url) { return url }
          if let string = value as? String, let url = SharedURLParser.firstHTTPURL(in: string) {
            return url
          }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
          let value = try await load(provider, typeIdentifier: UTType.plainText.identifier),
          let string = value as? String,
          let url = SharedURLParser.firstHTTPURL(in: string)
        {
          return url
        }
      }
    }
    return nil
  }

  private static func load(_ provider: NSItemProvider, typeIdentifier: String) async throws
    -> NSSecureCoding?
  {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: item)
        }
      }
    }
  }
}

enum SharedRecipeAPI {
  private struct RequestBody: Encodable { let url: String }

  static func add(url: URL, token: String) async throws {
    guard let baseURLString = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
      let baseURL = URL(string: baseURLString),
      let endpoint = URL(string: "/v1/recipes", relativeTo: baseURL)
    else {
      throw ShareExtensionError.invalidResponse
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(RequestBody(url: url.absoluteString))
    let (_, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse,
      (200..<300).contains(httpResponse.statusCode)
    else {
      throw ShareExtensionError.invalidResponse
    }
  }
}
