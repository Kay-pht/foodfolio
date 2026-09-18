import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const source = await readFile(
  new URL(
    "../../ios/FoodfolioShareExtension/ShareViewController.swift",
    import.meta.url,
  ),
  "utf8",
);
const project = await readFile(
  new URL("../../ios/project.yml", import.meta.url),
  "utf8",
);

describe("Share Extension compose validation", () => {
  it("revalidates the system Post action whenever async state changes", () => {
    const stateObserver = source.match(
      /private var state: State = \.loading \{\s*didSet \{([\s\S]*?)\n\s*\}\s*\}/,
    );

    expect(stateObserver).not.toBeNull();
    expect(stateObserver?.[1]).toContain("updateUI()");
    expect(stateObserver?.[1]).toContain("validateContent()");
  });

  it("uses the system Post and Cancel controls instead of custom navigation items", () => {
    expect(source).not.toContain("navigationItem.leftBarButtonItem");
    expect(source).not.toContain("navigationItem.rightBarButtonItem");
    expect(source).not.toContain("configureNavigationItems()");
    expect(source).not.toContain("setCreateButton(");
    const didSelectPost = source.match(
      /override func didSelectPost\(\) \{([\s\S]*?)\n\s*\}/,
    );
    expect(didSelectPost?.[1]).toContain("presentSubmittingAlert()");
    expect(didSelectPost?.[1]).toContain("createRecipe()");
  });

  it("keeps Post available for retry only when a shared URL still exists", () => {
    expect(source).toMatch(/case \.ready:\s*true/);
    expect(source).toMatch(/case \.failure:\s*creationGate\.sharedURL != nil/);
    expect(source).toMatch(/case \.loading, \.submitting, \.success:\s*false/);
  });

  it("acknowledges success before completing the extension request", () => {
    expect(source).toContain("state = .success");
    expect(source).toContain("showSuccessResult()");
    expect(source).toContain('title: "閉じる"');
    expect(source).toContain('title: "再試行"');
  });

  it("shows plain-language submission progress and success status", () => {
    expect(source).toContain('title: "確認中"');
    expect(source).toContain("UIActivityIndicatorView(style: .medium)");
    expect(source).toContain("indicator.startAnimating()");
    expect(source).toContain('alert.title = "✓ 送信"');
    expect(source).not.toContain("Backendへ送信");
  });

  it("uses Light appearance for the Share Extension", () => {
    const extensionTarget = project.slice(
      project.indexOf("  FoodfolioShareExtension:"),
      project.indexOf("  FoodfolioTests:"),
    );

    expect(extensionTarget).toContain("UIUserInterfaceStyle: Light");
  });
});
