import FirebaseAuth
import FirebaseCore
import Foundation
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
  private enum State {
    case loading
    case ready(URL)
    case submitting
    case success
    case failure(String)
  }

  private var state: State = .loading {
    didSet {
      updateUI()
      validateContent()
    }
  }
  private var creationGate = ShareCreationGate()

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Foodfolio"
    placeholder = "共有するレシピURLを確認してください"
    textView.isEditable = false
    updateUI()
    validateContent()

    Task { @MainActor in
      await loadSharedURL()
    }
  }

  override func isContentValid() -> Bool {
    switch state {
    case .ready:
      true
    case .failure:
      creationGate.sharedURL != nil
    case .loading, .submitting, .success:
      false
    }
  }

  override func didSelectPost() {
    createRecipe()
  }

  private func loadSharedURL() async {
    do {
      guard
        let url = try await SharedURLExtractor.firstURL(from: extensionContext?.inputItems ?? [])
      else {
        throw ShareExtensionError.urlNotFound
      }
      creationGate.prepare(url: url)
      state = .ready(url)
    } catch {
      let fallback = "URLを取得できませんでした。"
      state = .failure((error as? LocalizedError)?.errorDescription ?? fallback)
    }
  }

  private func createRecipe() {
    guard !isSubmittingOrFinished else { return }
    guard let url = creationGate.confirm() else { return }
    state = .submitting

    Task { @MainActor in
      await saveSharedRecipe(url: url)
    }
  }

  private var isSubmittingOrFinished: Bool {
    switch state {
    case .submitting, .success:
      true
    case .loading, .ready, .failure:
      false
    }
  }

  private func saveSharedRecipe(url: URL) async {
    do {
      try configureFirebaseIfNeeded()
      guard let user = Auth.auth().currentUser else {
        throw ShareExtensionError.loginRequired
      }
      let token = try await user.getIDToken()
      try await SharedRecipeAPI.add(url: url, token: token)
      state = .success
      extensionContext?.completeRequest(returningItems: nil)
    } catch {
      creationGate.resetConfirmation()
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
      textView.text = "共有するURLを確認しています…"
    case .ready(let url):
      textView.text = url.absoluteString
    case .submitting:
      textView.text = "レシピを作成しています…"
    case .success:
      textView.text = "Foodfolioにレシピを追加しました。"
    case .failure(let message):
      textView.text = message
    }
  }
}

enum ShareExtensionError: LocalizedError {
  case urlNotFound
  case loginRequired
  case configurationMissing
  case invalidResponse

  var errorDescription: String? {
    switch self {
    case .urlNotFound:
      "URLを取得できませんでした。"
    case .loginRequired:
      "Foodfolioアプリでログインしてください。"
    case .configurationMissing:
      "Foodfolioの共有機能を初期化できませんでした。"
    case .invalidResponse:
      "レシピの追加に失敗しました。"
    }
  }
}

@MainActor
enum SharedURLExtractor {
  static func firstURL(from inputItems: [Any]) async throws -> URL? {
    for case let item as NSExtensionItem in inputItems {
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
          let url = try await loadURL(from: provider)
        {
          return url
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
          let text = try await loadText(from: provider),
          let url = SharedURLParser.firstHTTPURL(in: text)
        {
          return url
        }
      }
    }
    return nil
  }

  private static func loadURL(from provider: NSItemProvider) async throws -> URL? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let url = item as? URL, SharedURLParser.isHTTPURL(url) {
          continuation.resume(returning: url)
        } else if let text = item as? String {
          continuation.resume(returning: SharedURLParser.firstHTTPURL(in: text))
        } else {
          continuation.resume(returning: nil)
        }
      }
    }
  }

  private static func loadText(from provider: NSItemProvider) async throws -> String? {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) {
        item, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: item as? String)
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
