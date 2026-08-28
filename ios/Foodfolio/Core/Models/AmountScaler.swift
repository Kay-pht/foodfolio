import Foundation

enum AmountScaler {
  static func scale(_ amount: String?, multiplier: Double) -> String? {
    guard let amount, multiplier > 0 else { return amount }
    guard !approximatelyEqual(multiplier, 1) else { return amount }

    if let mixed = match(#"^(.*?)(\d+)(?:と|\s+)(\d+)\/(\d+)(.*)$"#, in: amount),
      let whole = Int64(mixed[1]),
      let numerator = Int64(mixed[2]),
      let denominator = Int64(mixed[3]),
      denominator > 0,
      let source = Rational.mixed(
        whole: whole, numerator: numerator, denominator: denominator),
      let scaled = source.multiplied(by: Rational.approximate(multiplier))
    {
      return mixed[0] + scaled.formatted + mixed[4]
    }

    if let fraction = match(#"^(.*?)(\d+)\/(\d+)(.*)$"#, in: amount),
      let numerator = Int64(fraction[1]),
      let denominator = Int64(fraction[2]),
      denominator > 0,
      let source = Rational(numerator: numerator, denominator: denominator),
      let scaled = source.multiplied(by: Rational.approximate(multiplier))
    {
      return fraction[0] + scaled.formatted + fraction[3]
    }

    guard let decimal = match(#"^(.*?)(\d+(?:\.\d+)?)(.*)$"#, in: amount),
      let value = Double(decimal[1])
    else { return amount }
    let scaled = value * multiplier
    let formatted =
      scaled.rounded() == scaled
      ? String(Int(scaled))
      : String(format: "%.2f", scaled).replacingOccurrences(
        of: #"\.?0+$"#, with: "", options: .regularExpression)
    return decimal[0] + formatted + decimal[2]
  }

  private static func match(_ pattern: String, in value: String) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern),
      let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
      match.range.location != NSNotFound
    else { return nil }
    let groups = (1..<match.numberOfRanges).compactMap {
      Range(match.range(at: $0), in: value).map { String(value[$0]) }
    }
    return groups.count == match.numberOfRanges - 1 ? groups : nil
  }

  private static func approximatelyEqual(_ lhs: Double, _ rhs: Double) -> Bool {
    abs(lhs - rhs) < 0.000_000_001
  }

  private struct Rational {
    let numerator: Int64
    let denominator: Int64

    init?(numerator: Int64, denominator: Int64) {
      guard numerator >= 0, denominator > 0 else { return nil }
      let divisor = Self.greatestCommonDivisor(numerator, denominator)
      self.numerator = numerator / divisor
      self.denominator = denominator / divisor
    }

    static func approximate(_ value: Double) -> Rational {
      for denominator in 1...1_000 {
        let numerator = (value * Double(denominator)).rounded()
        guard numerator <= Double(Int64.max) else { break }
        if abs(numerator / Double(denominator) - value) < 0.000_000_001 {
          return Rational(numerator: Int64(numerator), denominator: Int64(denominator))!
        }
      }
      let numerator = min((value * 1_000).rounded(), Double(Int64.max))
      return Rational(numerator: Int64(numerator), denominator: 1_000)!
    }

    func multiplied(by other: Rational) -> Rational? {
      let (scaledNumerator, numeratorOverflow) = numerator.multipliedReportingOverflow(
        by: other.numerator)
      let (scaledDenominator, denominatorOverflow) = denominator.multipliedReportingOverflow(
        by: other.denominator)
      guard !numeratorOverflow, !denominatorOverflow else { return nil }
      return Rational(numerator: scaledNumerator, denominator: scaledDenominator)
    }

    var formatted: String {
      let whole = numerator / denominator
      let remainder = numerator % denominator
      if remainder == 0 { return String(whole) }
      if whole > 0 { return "\(whole)と\(remainder)/\(denominator)" }
      return "\(remainder)/\(denominator)"
    }

    private static func greatestCommonDivisor(_ lhs: Int64, _ rhs: Int64) -> Int64 {
      var lhs = lhs
      var rhs = rhs
      while rhs != 0 { (lhs, rhs) = (rhs, lhs % rhs) }
      return max(lhs, 1)
    }

    static func mixed(
      whole: Int64, numerator: Int64, denominator: Int64
    ) -> Rational? {
      let (wholeNumerator, multiplicationOverflow) = whole.multipliedReportingOverflow(
        by: denominator)
      let (combinedNumerator, additionOverflow) = wholeNumerator.addingReportingOverflow(numerator)
      guard !multiplicationOverflow, !additionOverflow else { return nil }
      return Rational(numerator: combinedNumerator, denominator: denominator)
    }
  }
}
