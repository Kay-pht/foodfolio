import Foundation

enum SharedURLParser {
  static func firstHTTPURL(in text: String) -> URL? {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    else {
      return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    for match in detector.matches(in: text, options: [], range: range) {
      guard let url = match.url, isHTTPURL(url) else { continue }
      return url
    }
    return nil
  }

  static func isHTTPURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    return scheme == "http" || scheme == "https"
  }
}
