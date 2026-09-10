import Foundation
import XCTest

@testable import Foodfolio

final class SharedRecipeSubmissionTests: XCTestCase {
  func testAcceptsSuccessfulBackendResponseWithoutWaitingForAnalysis() throws {
    XCTAssertNoThrow(
      try SharedRecipeSubmissionResponse.validate(statusCode: 201, data: Data("{}".utf8)))
  }

  func testMapsDuplicateResponseToSpecificMessage() {
    assertFailure(
      statusCode: 409,
      code: "DUPLICATE_RECIPE",
      expected: .duplicateRecipe,
      message: "このレシピはすでに保存されています。")
  }

  func testMapsAnalysisLimitResponseToSpecificMessage() {
    assertFailure(
      statusCode: 429,
      code: "ANALYSIS_LIMIT_EXCEEDED",
      expected: .analysisLimitExceeded,
      message: "解析受付の上限に達しています。")
  }

  func testMapsAuthenticationResponseToSpecificMessage() {
    assertFailure(
      statusCode: 401,
      code: "UNAUTHENTICATED",
      expected: .unauthenticated,
      message: "Foodfolioアプリで再度ログインしてください。")
  }

  func testMapsInvalidRequestResponseToSpecificMessage() {
    assertFailure(
      statusCode: 400,
      code: "INVALID_URL",
      expected: .invalidRequest,
      message: "有効なレシピURLを共有してください。")
  }

  func testMapsUnknownServerResponseToGenericFailure() {
    assertFailure(
      statusCode: 503,
      code: "INTERNAL_ERROR",
      expected: .server,
      message: "追加に失敗しました。")
  }

  func testTransportFailureHasSpecificMessage() {
    XCTAssertEqual(
      SharedRecipeSubmissionFailure.transport.errorDescription,
      "通信できませんでした。接続を確認してもう一度お試しください。")
  }

  func testOnlyTransientSubmissionFailuresAreRetryable() {
    XCTAssertTrue(SharedRecipeSubmissionFailure.transport.isRetryable)
    XCTAssertTrue(SharedRecipeSubmissionFailure.server.isRetryable)
    XCTAssertFalse(SharedRecipeSubmissionFailure.duplicateRecipe.isRetryable)
    XCTAssertFalse(SharedRecipeSubmissionFailure.analysisLimitExceeded.isRetryable)
    XCTAssertFalse(SharedRecipeSubmissionFailure.unauthenticated.isRetryable)
    XCTAssertFalse(SharedRecipeSubmissionFailure.invalidRequest.isRetryable)
  }

  private func assertFailure(
    statusCode: Int,
    code: String,
    expected: SharedRecipeSubmissionFailure,
    message: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let json = "{\"error\":{\"code\":\"\(code)\",\"message\":\"test\",\"requestId\":\"req\"}}"
    let data = Data(json.utf8)

    XCTAssertThrowsError(
      try SharedRecipeSubmissionResponse.validate(statusCode: statusCode, data: data),
      file: file,
      line: line
    ) { error in
      XCTAssertEqual(error as? SharedRecipeSubmissionFailure, expected, file: file, line: line)
      XCTAssertEqual(
        (error as? LocalizedError)?.errorDescription, message, file: file, line: line)
    }
  }
}
