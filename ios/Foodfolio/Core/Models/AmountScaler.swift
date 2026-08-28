import Foundation

enum AmountScaler {
  static func scale(_ amount: String?, multiplier: Double) -> String? {
    guard let amount, multiplier > 0 else { return amount }
    let patterns = [#"^(.*?)(\d+)\/(\d+)(.*)$"#, #"^(.*?)(\d+(?:\.\d+)?)(.*)$"#]
    for (index, pattern) in patterns.enumerated() {
      guard let regex = try? NSRegularExpression(pattern: pattern),
        let match = regex.firstMatch(in: amount, range: NSRange(amount.startIndex..., in: amount)),
        match.range.location != NSNotFound
      else { continue }
      let groups = (1..<match.numberOfRanges).compactMap {
        Range(match.range(at: $0), in: amount).map { String(amount[$0]) }
      }
      let value: Double
      let prefix: String
      let suffix: String
      if index == 0, groups.count == 4, let numerator = Double(groups[1]),
        let denominator = Double(groups[2]), denominator != 0
      {
        prefix = groups[0]
        value = numerator / denominator
        suffix = groups[3]
      } else if groups.count == 3, let number = Double(groups[1]) {
        prefix = groups[0]
        value = number
        suffix = groups[2]
      } else {
        continue
      }
      let scaled = value * multiplier
      let formatted =
        scaled.rounded() == scaled
        ? String(Int(scaled))
        : String(format: "%.2f", scaled).replacingOccurrences(
          of: #"\.?0+$"#, with: "", options: .regularExpression)
      return prefix + formatted + suffix
    }
    return amount
  }
}
