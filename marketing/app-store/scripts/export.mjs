import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { slides } from "../src/slides.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const output = path.join(root, "output");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const candidate = path.resolve(root, `.${pathname}`);

    if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const file = await readFile(candidate);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(candidate).toLowerCase()) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to start local preview server.");
}

await mkdir(output, { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1320, height: 2868 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const slide of slides) {
    const url = `http://127.0.0.1:${address.port}/src/index.html?slide=${encodeURIComponent(slide.id)}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.ready === "true");

    const artboard = page.locator("#artboard");
    const box = await artboard.boundingBox();
    if (!box || box.width !== 1320 || box.height !== 2868) {
      throw new Error(`Unexpected artboard size for ${slide.id}: ${JSON.stringify(box)}`);
    }

    const destination = path.join(output, `${slide.id}.png`);
    await artboard.screenshot({
      path: destination,
      animations: "disabled",
      omitBackground: false,
      scale: "css",
    });
    console.log(`generated ${path.relative(root, destination)}`);
  }

  await context.close();
} finally {
  await browser.close();
  server.close();
}
