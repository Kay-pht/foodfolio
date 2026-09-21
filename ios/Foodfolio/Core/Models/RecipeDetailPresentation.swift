import Foundation

enum ServingsControlPresentation: Equatable {
  case hidden
  case fixed(text: String)
  case adjustable(text: String, canDecrease: Bool, canIncrease: Bool)
}

enum RecipeDetailPresentation {
  static let minimumServings = 1.0
  static let maximumServings = 20.0

  static func showsAnalysisFailure(for status: AnalysisStatus) -> Bool {
    status == .failed
  }

  static func canEdit(status: AnalysisStatus) -> Bool {
    ![.pending, .processing, .notRecipe].contains(status)
  }

  static func servingsControl(
    raw: String?, base: Double?, displayed: Double?
  ) -> ServingsControlPresentation {
    guard let raw else { return .hidden }
    guard let base, base > 0 else {
      return .fixed(text: ServingDisplayFormatter.text(value: nil, raw: raw))
    }

    let current = displayed ?? base
    return .adjustable(
      text: ServingDisplayFormatter.text(value: current, raw: raw),
      canDecrease: current > minimumServings,
      canIncrease: current < maximumServings)
  }

  static func updatedServings(current: Double?, base: Double, delta: Double) -> Double {
    min(maximumServings, max(minimumServings, (current ?? base) + delta))
  }

  static func scaledAmount(_ amount: String?, base: Double?, displayed: Double?) -> String? {
    guard let base, base > 0, let displayed else { return amount }
    return AmountScaler.scale(amount, multiplier: displayed / base)
  }
}
