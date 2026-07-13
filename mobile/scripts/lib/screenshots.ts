import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { MOBILE_APP_DIR, SCRIPTS_DIR, resolveScriptPath, type StoresConfig } from "./config";

const SERVE_PORT = 8791;
const CDP_PORT = 9226;

/* ------------------------------------------------------------------ */
/* Chrome discovery + DevTools Protocol client                         */
/* ------------------------------------------------------------------ */

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ].filter((c): c is string => Boolean(c));
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error("No Chrome/Edge found — set CHROME_PATH to a Chromium binary.");
  }
  return found;
}

class CdpSession {
  private nextId = 1;
  private pending = new Map<number, (value: { result?: any; error?: { message: string } }) => void>();

  private constructor(
    private readonly chrome: ReturnType<typeof Bun.spawn>,
    private readonly ws: WebSocket,
  ) {}

  static async launch(): Promise<CdpSession> {
    const profile = join(SCRIPTS_DIR, ".chrome-profile");
    const chrome = Bun.spawn(
      [
        findChrome(),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );

    let wsUrl: string | null = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()) as Array<{
          type: string;
          webSocketDebuggerUrl: string;
        }>;
        wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
      } catch {
        await Bun.sleep(250);
      }
    }
    if (!wsUrl) {
      chrome.kill();
      throw new Error("Chrome DevTools endpoint did not come up.");
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      ws.addEventListener("open", resolveOpen);
      ws.addEventListener("error", () => rejectOpen(new Error("DevTools websocket failed")));
    });
    const session = new CdpSession(chrome, ws);
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number };
      if (message.id && session.pending.has(message.id)) {
        session.pending.get(message.id)!(message as never);
        session.pending.delete(message.id);
      }
    });
    return session;
  }

  async send(method: string, params: object = {}): Promise<any> {
    const id = this.nextId++;
    const reply = await new Promise<{ result?: any; error?: { message: string } }>((resolveReply) => {
      this.pending.set(id, resolveReply);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    if (reply.error) throw new Error(`CDP ${method}: ${reply.error.message}`);
    return reply.result;
  }

  async shoot(options: {
    url: string;
    outFile: string;
    width: number;
    height: number;
    deviceScaleFactor: number;
    waitMs: number;
    format: "png" | "jpeg";
  }): Promise<void> {
    const cssWidth = Math.round(options.width / options.deviceScaleFactor);
    const cssHeight = Math.round(options.height / options.deviceScaleFactor);
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: cssWidth,
      height: cssHeight,
      deviceScaleFactor: options.deviceScaleFactor,
      mobile: true,
    });
    await this.send("Page.navigate", { url: options.url });
    await Bun.sleep(options.waitMs);
    const shot = await this.send("Page.captureScreenshot", {
      format: options.format,
      ...(options.format === "jpeg" ? { quality: 92 } : {}),
    });
    await Bun.write(options.outFile, Buffer.from(shot.data as string, "base64"));
  }

  close(): void {
    try {
      this.ws.close();
    } finally {
      this.chrome.kill();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Web export + static server                                          */
/* ------------------------------------------------------------------ */

async function exportWebBuild(): Promise<string> {
  const outDir = join(MOBILE_APP_DIR, "dist-store-screens");
  console.log("  exporting web build (bunx expo export --platform web)...");
  const proc = Bun.spawn(["bunx", "expo", "export", "--platform", "web", "--output-dir", "dist-store-screens"], {
    cwd: MOBILE_APP_DIR,
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`expo export failed: ${await new Response(proc.stderr).text()}`);
  }
  return outDir;
}

function serveDir(dir: string) {
  return Bun.serve({
    port: SERVE_PORT,
    async fetch(request) {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      let file = Bun.file(join(dir, pathname));
      if (!(await file.exists())) file = Bun.file(join(dir, "index.html"));
      return new Response(file);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Marketing asset templates (Play feature graphic + icon)             */
/* ------------------------------------------------------------------ */

function marketingHtml(kind: "feature" | "icon"): string {
  const markPath = resolve(MOBILE_APP_DIR, "assets/brand/vorinthex-mark.png");
  const mark = `data:image/png;base64,${readFileSync(markPath).toString("base64")}`;
  const featureBody = `
    <div style="display:flex;flex-direction:row;align-items:center;justify-content:center;gap:56px;height:100%">
      <img src="${mark}" style="width:300px;height:300px" />
      <div style="display:flex;flex-direction:column;gap:18px">
        <div style="color:#DDE2E5;font-size:44px;letter-spacing:14px;font-weight:500">VORINTHEX CORE</div>
        <div style="color:#AEB6BC;font-size:22px;letter-spacing:8px">YOUR AI BRAIN</div>
      </div>
    </div>`;
  const iconBody = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%">
      <img src="${mark}" style="width:72%;height:72%" />
    </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#030507;height:100%;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
  </style></head><body>${kind === "feature" ? featureBody : iconBody}</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Public entry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Generates every store visual from the real app: screenshots per target
 * (captured from the Expo web export in headless Chrome at exact store
 * pixel sizes) plus the Play feature graphic and 512px icon.
 */
export async function generateStoreAssets(config: StoresConfig): Promise<void> {
  const generator = config.screenshotGenerator;
  const distDir = await exportWebBuild();
  const server = serveDir(distDir);
  const cdp = await CdpSession.launch();

  try {
    for (const target of generator.targets) {
      const outDir = resolveScriptPath(target.dir);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      console.log(`  ${target.store} ${target.label} (${target.width}x${target.height})`);
      for (const route of generator.routes) {
        const outFile = join(outDir, `${route.name}.jpg`);
        await cdp.shoot({
          url: `http://localhost:${SERVE_PORT}${route.path}`,
          outFile,
          width: target.width,
          height: target.height,
          deviceScaleFactor: target.deviceScaleFactor,
          waitMs: route.waitMs,
          format: "jpeg",
        });
        console.log(`    ${route.name}.jpg`);
      }
    }

    // Play marketing assets: 1024x500 feature graphic (JPEG, no alpha
    // allowed) and 512x512 icon (PNG, alpha allowed).
    const storeAssetsDir = resolveScriptPath("assets/store");
    mkdirSync(storeAssetsDir, { recursive: true });

    const featureUrl = `data:text/html;base64,${Buffer.from(marketingHtml("feature")).toString("base64")}`;
    await cdp.shoot({
      url: featureUrl,
      outFile: resolveScriptPath(config.google.images.featureGraphic),
      width: 1024,
      height: 500,
      deviceScaleFactor: 1,
      waitMs: 600,
      format: "jpeg",
    });
    console.log("  feature graphic 1024x500");

    const iconUrl = `data:text/html;base64,${Buffer.from(marketingHtml("icon")).toString("base64")}`;
    await cdp.shoot({
      url: iconUrl,
      outFile: resolveScriptPath(config.google.images.icon),
      width: 512,
      height: 512,
      deviceScaleFactor: 1,
      waitMs: 600,
      format: "png",
    });
    console.log("  play icon 512x512");
  } finally {
    cdp.close();
    server.stop(true);
    rmSync(distDir, { recursive: true, force: true });
  }
}
