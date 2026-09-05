import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

async function html(path: string) {
  return load(await readFile(resolve(root, "hosting/public", path), "utf8"));
}

describe("public information hosting", () => {
  it("configures the Foodfolio Firebase Hosting site", async () => {
    const config = JSON.parse(
      await readFile(resolve(root, "firebase.json"), "utf8"),
    ) as { hosting: { public: string } };
    const project = JSON.parse(
      await readFile(resolve(root, ".firebaserc"), "utf8"),
    ) as { projects: { default: string } };

    expect(config.hosting.public).toBe("hosting/public");
    expect(project.projects.default).toBe("foodfolio-af28aa");
  });

  it("publishes navigable Japanese privacy and support pages", async () => {
    const index = await html("index.html");
    const privacy = await html("privacy/index.html");
    const support = await html("support/index.html");

    for (const page of [index, privacy, support]) {
      expect(page("html").attr("lang")).toBe("ja");
      expect(page("h1").text().trim()).not.toBe("");
    }

    expect(index('a[href="/privacy"]').length).toBe(1);
    expect(index('a[href="/support"]').length).toBe(1);
    expect(privacy.text().replace(/\s+/g, " ")).toContain(
      "Firebase Authentication",
    );
    expect(privacy.text()).toContain("Neon");
    expect(privacy.text()).toContain("Z.ai");
    expect(privacy.text().replace(/\s+/g, " ")).toContain("Google Gemini");
    expect(privacy.text()).toContain("公開YouTube動画とそのURL、説明欄");
    expect(support('a[href="mailto:kei.patheng@gmail.com"]').length).toBe(1);
  });

  it("keeps the private review phone number out of public files", async () => {
    const pages = await Promise.all([
      readFile(resolve(root, "hosting/public/index.html"), "utf8"),
      readFile(resolve(root, "hosting/public/privacy/index.html"), "utf8"),
      readFile(resolve(root, "hosting/public/support/index.html"), "utf8"),
    ]);

    expect(pages.join("\n")).not.toMatch(
      /href=["']tel:|0[789]0[-\s]?\d{4}[-\s]?\d{4}|\+81[-\s]?\d/,
    );
  });
});
