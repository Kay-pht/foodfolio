import UIKit
import XCTest

@MainActor
final class SharePresentationTests: XCTestCase {
  func testTextInputRemainsReadyUntilSheetPresentationFinishes() {
    let controller = ShareViewController()
    controller.loadViewIfNeeded()

    XCTAssertTrue(controller.textView.isEditable)
    XCTAssertTrue(controller.textView.delegate === controller)
  }

  func testConfirmationTextRejectsTypingPastingAndDeletionDuringPresentation() {
    let controller = ShareViewController()
    controller.loadViewIfNeeded()
    let textView = controller.textView!
    let originalText = textView.text

    for replacement in ["x", "https://example.com/other", ""] {
      XCTAssertEqual(
        textView.delegate?.textView?(
          textView, shouldChangeTextIn: NSRange(location: 0, length: 1),
          replacementText: replacement),
        false)
      XCTAssertEqual(
        textView.delegate?.textView?(
          textView,
          shouldChangeTextInRanges: [
            NSValue(range: NSRange(location: 0, length: 1)),
            NSValue(range: NSRange(location: 2, length: 1)),
          ], replacementText: replacement),
        false)
    }
    XCTAssertEqual(textView.text, originalText)
  }

  func testPresentationCompletionLocksTextWithoutChangingContentOrValidation() {
    let controller = ShareViewController()
    controller.loadViewIfNeeded()
    let originalText = controller.textView.text
    let wasValid = controller.isContentValid()

    controller.presentationAnimationDidFinish()
    controller.presentationAnimationDidFinish()

    XCTAssertFalse(controller.textView.isEditable)
    XCTAssertEqual(controller.textView.text, originalText)
    XCTAssertEqual(controller.isContentValid(), wasValid)
  }
}
