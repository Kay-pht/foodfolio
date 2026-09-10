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
    expect(source).toMatch(
      /override func didSelectPost\(\) \{\s*createRecipe\(\)\s*\}/,
    );
  });

  it("keeps Post available for retry only when a shared URL still exists", () => {
    expect(source).toMatch(/case \.ready:\s*true/);
    expect(source).toMatch(
      /case \.failure:\s*creationGate\.sharedURL != nil/,
    );
    expect(source).toMatch(
      /case \.loading, \.submitting, \.success:\s*false/,
    );
  });
});
