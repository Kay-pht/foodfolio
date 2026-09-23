import { createServer } from "node:http";
import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { slides, sourceAssets } from "../src/slides.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const output = path.join(root, "output");
const generatedFrames = path.join(root, ".generated", "frames");
const bezels = path.join(root, "bezels");
const framesJson = path.join(bezels, "frames.json");
const cli = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "dkbezeler.cmd" : "dkbezeler",
);

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureOfficialBezels() {
  if (await exists(framesJson)) return;

  if (process.platform !== "darwin") {
    throw new Error(
      [
        "Apple公式Product Bezelが未セットアップです。",
        "Appleの配布物はDMGのため、自動展開はmacOSでのみ行います。",
        "macOSで marketing/app-store から npm run generate を実行するか、",
        "Apple Design ResourcesからiPhone 17のProduct Bezelsを取得して bezels/ に配置してください。",
      ].join("\n"),
    );
  }

  console.log("Apple公式 iPhone 17 Product Bezels を取得します...");
  await execFileAsync(cli, ["init", "iphone-17"], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function buildFramedScreenshots() {
  await ensureOfficialBezels();
  await mkdir(generatedFrames, { recursive: true });

  for (const fileName of sourceAssets) {
    const input = path.join(root, "assets", fileName);
    const baseName = path.parse(fileName).name;
    const framed = path.join(generatedFrames, `${baseName}-framed.png`);

    if (await exists(framed)) continue;

    console.log(`frame ${fileName}`);
    await execFileAsync(
      cli,
      [
        input,
        "--dir",
        bezels,
        "--out",
        generatedFrames,
        "--name",
        baseName,
      ],
      {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
  }
}

await buildFramedScreenshots();

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
      "Content-Type":
        mimeTypes.get(path.extname(candidate).toLowerCase()) ??
        "application/octet-stream",
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
    await page.waitForFunction(
      () => document.documentElement.dataset.ready === "true",
    );

    const artboard = page.locator("#artboard");
    const box = await artboard.boundingBox();
    if (!box || box.width !== 1320 || box.height !== 2868) {
      throw new Error(
        `Unexpected artboard size for ${slide.id}: ${JSON.stringify(box)}`,
      );
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
