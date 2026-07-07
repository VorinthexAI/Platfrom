import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.REFERENCE_BASE_URL ?? "http://localhost:3000";
const outputDir = path.resolve("reference-images/landing");

const captures = [
  { name: "home-desktop", path: "/", width: 1440, height: 1200 },
  { name: "core-desktop", path: "/core", width: 1440, height: 1200 },
  { name: "command-desktop", path: "/command", width: 1440, height: 1200 },
  { name: "studio-desktop", path: "/studio", width: 1440, height: 1200 },
  { name: "launch-desktop", path: "/launch", width: 1440, height: 1200 },
  { name: "home-vertical", path: "/", width: 720, height: 1280 },
  { name: "core-vertical", path: "/core", width: 720, height: 1280 },
  { name: "command-vertical", path: "/command", width: 720, height: 1280 },
  { name: "studio-vertical", path: "/studio", width: 720, height: 1280 },
  { name: "launch-vertical", path: "/launch", width: 720, height: 1280 }
];

await mkdir(outputDir, { recursive: true });

const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const executablePath = chromePaths.find((candidate) => existsSync(candidate));

const browser = await chromium.launch({
  headless: true,
  executablePath,
  timeout: 60_000,
  args: ["--disable-gpu", "--disable-dev-shm-usage"]
});

try {
  for (const capture of captures) {
    const page = await browser.newPage({
      viewport: { width: capture.width, height: capture.height },
      deviceScaleFactor: 1
    });
    page.setDefaultTimeout(45_000);
    await page.goto(new URL(capture.path, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await page.waitForTimeout(4_000);
    await page.screenshot({
      path: path.join(outputDir, `${capture.name}.png`),
      fullPage: false,
      timeout: 45_000
    });
    await page.close();
    console.log(`${capture.name}.png`);
  }
} finally {
  await browser.close();
}
