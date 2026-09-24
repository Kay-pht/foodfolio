import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  PORTRAIT_FRAME_NAME,
  PORTRAIT_FRAME_SIZE,
  frameArguments,
} from "../src/frame-config.js";
import { slides, sourceAssets } from "../src/slides.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const output = path.join(root, "output");
const generatedFrames = path.join(root, ".generated", "frames");
const generatedFrameSelection = path.join(
  generatedFrames,
  "frame-selection.json",
);
const bezels = path.join(root, "bezels");
const framesJson = path.join(bezels, "frames.json");
const officialBezelUrl =
  "https://devimages-cdn.apple.com/design/resources/download/Bezel-iPhone-18.dmg";
const officialFrameFileName = "iPhone 18 Pro - Burgundy - Portrait.png";
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

async function hasPortraitFrameSize(target) {
  if (!(await exists(target))) return false;

  const header = await readFile(target);
  if (header.length < 24 || header.toString("ascii", 1, 4) !== "PNG") {
    return false;
  }

  return (
    header.readUInt32BE(16) === PORTRAIT_FRAME_SIZE.width &&
    header.readUInt32BE(20) === PORTRAIT_FRAME_SIZE.height
  );
}

async function selectedFrameIsRegistered() {
  if (!(await exists(framesJson))) return false;

  const manifest = JSON.parse(await readFile(framesJson, "utf8"));
  return manifest.frames?.some(({ name }) => name === PORTRAIT_FRAME_NAME);
}

async function runWithInput(command, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

async function installOfficialIPhone18Bezel() {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "foodfolio-iphone-18-bezel-"),
  );
  const dmg = path.join(temporaryRoot, "Bezel-iPhone-18.dmg");
  const mount = path.join(temporaryRoot, "mount");
  await mkdir(mount);

  let mounted = false;
  try {
    console.log("Apple公式 iPhone 18 Product Bezels を取得します...");
    const response = await fetch(officialBezelUrl);
    if (!response.ok || !response.body) {
      throw new Error(
        `Apple Product Bezel download failed: ${response.status} ${response.statusText}`,
      );
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(dmg));

    await runWithInput(
      "hdiutil",
      ["attach", dmg, "-mountpoint", mount, "-nobrowse", "-readonly"],
      "Y\n",
    );
    mounted = true;

    const source = path.join(
      mount,
      "PNG",
      "iPhone 18 Pro",
      officialFrameFileName,
    );
    const destination = path.join(bezels, officialFrameFileName);
    await mkdir(bezels, { recursive: true });
    await copyFile(source, destination);
    await execFileAsync(
      cli,
      ["measure", destination, "--name", PORTRAIT_FRAME_NAME, "--dir", bezels],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 },
    );
  } finally {
    if (mounted) {
      await execFileAsync("hdiutil", ["detach", mount, "-quiet"]);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function ensureOfficialBezels() {
  if (await selectedFrameIsRegistered()) return;

  if (process.platform !== "darwin") {
    throw new Error(
      [
        "Apple公式Product Bezelが未セットアップです。",
        "Appleの配布物はDMGのため、自動展開はmacOSでのみ行います。",
        "macOSで marketing/app-store から npm run generate を実行するか、",
        "Apple Design ResourcesからiPhone 18のProduct Bezelsを取得して bezels/ に配置してください。",
      ].join("\n"),
    );
  }

  await installOfficialIPhone18Bezel();
}

async function buildFramedScreenshots() {
  await ensureOfficialBezels();
  await mkdir(generatedFrames, { recursive: true });
  let selectionMatches = false;
  if (await exists(generatedFrameSelection)) {
    const selection = JSON.parse(
      await readFile(generatedFrameSelection, "utf8"),
    );
    selectionMatches = selection.frameName === PORTRAIT_FRAME_NAME;
  }

  for (const fileName of sourceAssets) {
    const input = path.join(root, "assets", fileName);
    const baseName = path.parse(fileName).name;
    const framed = path.join(generatedFrames, `${baseName}-framed.png`);

    if (selectionMatches && (await hasPortraitFrameSize(framed))) continue;

    console.log(`frame ${fileName}`);
    await execFileAsync(
      cli,
      frameArguments(input, bezels, generatedFrames, baseName),
      {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
  }

  await writeFile(
    generatedFrameSelection,
    `${JSON.stringify({ frameName: PORTRAIT_FRAME_NAME }, null, 2)}\n`,
  );
}

await buildFramedScreenshots();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
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
const expectedOutputNames = new Set(slides.map(({ id }) => `${id}.png`));
for (const entry of await readdir(output, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    entry.name.endsWith(".png") &&
    !expectedOutputNames.has(entry.name)
  ) {
    await unlink(path.join(output, entry.name));
  }
}

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
