import FirebaseAuth
import FirebaseCore
import Foundation
import Social
import UIKit
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
  private var submissionAlert: UIAlertController?

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
    presentSubmittingAlert()
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
      showSuccessResult()
    } catch {
      creationGate.resetConfirmation()
      let fallback = "レシピの追加に失敗しました。"
      let message = (error as? LocalizedError)?.errorDescription ?? fallback
      state = .failure(message)
      showFailureResult(message: message, retryable: isRetryable(error))
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
      textView.text = "Foodfolioへの追加を受け付けました。"
    case .failure(let message):
      textView.text = message
    }
  }

  private func presentSubmittingAlert() {
    let alert = UIAlertController(
      title: "送信中",
      message: "FoodfolioのBackendへ送信しています…",
      preferredStyle: .alert)
    submissionAlert = alert
    present(alert, animated: true)
  }

  private func showSuccessResult() {
    guard let alert = submissionAlert else { return }
    alert.title = "送信完了"
    alert.message = "Foodfolioへの追加を受け付けました。"
    alert.addAction(
      UIAlertAction(title: "閉じる", style: .default) { [weak self] _ in
        self?.extensionContext?.completeRequest(returningItems: nil)
      })
  }

  private func showFailureResult(message: String, retryable: Bool) {
    guard let alert = submissionAlert else { return }
    alert.title = "追加できませんでした"
    alert.message = message
    if retryable {
      alert.addAction(
        UIAlertAction(title: "再試行", style: .default) { [weak self] _ in
          self?.submissionAlert?.dismiss(animated: true) { [weak self] in
            self?.submissionAlert = nil
            self?.presentSubmittingAlert()
            self?.createRecipe()
          }
        })
    }
    alert.addAction(
      UIAlertAction(title: "閉じる", style: .cancel) { [weak self] _ in
        self?.extensionContext?.completeRequest(returningItems: nil)
      })
  }

  private func isRetryable(_ error: Error) -> Bool {
    if let failure = error as? SharedRecipeSubmissionFailure {
      return failure.isRetryable
    }
    if error is ShareExtensionError {
      return false
    }
    return true
  }
}

enum ShareExtensionError: LocalizedError {
  case urlNotFound
  case loginRequired
  case configurationMissing

  var errorDescription: String? {
    switch self {
    case .urlNotFound:
      "URLを取得できませんでした。"
    case .loginRequired:
      "Foodfolioアプリでログインしてください。"
    case .configurationMissing:
      "Foodfolioの共有機能を初期化できませんでした。"
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
