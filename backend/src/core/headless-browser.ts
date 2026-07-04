import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser } from 'puppeteer-core';

const RENDER_TIMEOUT_MS = 30_000;

let browserPromise: Promise<Browser> | null = null;
const networkIdleSetContentOptions = { waitUntil: 'networkidle0' } as const;

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${RENDER_TIMEOUT_MS}ms`)), RENDER_TIMEOUT_MS);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: null,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  return browserPromise;
}

async function waitForFonts(page: Awaited<ReturnType<Browser['newPage']>>) {
  await page.evaluate(async () => {
    if ('fonts' in document) {
      await document.fonts.ready;
    }
  });
}

export async function renderHtmlToPng(html: string, dims: { width: number; height: number }): Promise<Buffer> {
  return timeout((async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: dims.width, height: dims.height, deviceScaleFactor: 1 });
      await page.setContent(html, networkIdleSetContentOptions as never);
      await waitForFonts(page);
      const output = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: dims.width, height: dims.height },
      });
      return Buffer.from(output);
    } finally {
      await page.close();
    }
  })(), 'renderHtmlToPng');
}

export async function renderHtmlToPdf(html: string, dims: { width: number; height: number }): Promise<Buffer> {
  return timeout((async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: dims.width, height: dims.height, deviceScaleFactor: 1 });
      await page.setContent(html, networkIdleSetContentOptions as never);
      await waitForFonts(page);
      const output = await page.pdf({
        width: `${dims.width}px`,
        height: `${dims.height}px`,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      return Buffer.from(output);
    } finally {
      await page.close();
    }
  })(), 'renderHtmlToPdf');
}

process.once('SIGTERM', () => {
  const current = browserPromise;
  browserPromise = null;
  if (current) {
    void current.then((browser) => browser.close()).catch(() => undefined);
  }
});
