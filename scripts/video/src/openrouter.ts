import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GenerateVideoInput, VideoConfig, VideoJob } from "./types";

type UnknownRecord = Record<string, unknown>;

export class OpenRouterVideoClient {
  constructor(private readonly config: VideoConfig) {
    if (!config.openRouterApiKey || config.openRouterApiKey === "your_key_here") {
      throw new Error("OPENROUTER_API_KEY is missing. Set it in scripts/video/.env before generating videos.");
    }
  }

  async generate(input: GenerateVideoInput): Promise<VideoJob> {
    const body: UnknownRecord = {
      model: input.model,
      prompt: input.prompt,
      duration: input.duration,
      resolution: input.resolution,
      aspect_ratio: input.aspectRatio
    };
    if (this.config.sendAudioParam) {
      body.generate_audio = input.generateAudio;
      body.audio = input.generateAudio;
    }
    if (input.referenceImage) body.image_url = await this.referenceImageUrl(input.referenceImage);

    const response = await fetch(`${this.config.baseUrl}/videos`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body)
    });
    const json = await this.readJson(response);
    if (!response.ok) throw new Error(this.errorMessage(json, response.status));
    return this.parseJob(json);
  }

  async waitForCompletion(job: VideoJob): Promise<VideoJob> {
    const started = Date.now();
    let current = job;
    while (!["completed", "failed", "cancelled", "expired"].includes(current.status)) {
      if (Date.now() - started > this.config.pollTimeoutMs) throw new Error(`Video generation timed out for job ${job.id}`);
      await Bun.sleep(this.config.pollIntervalMs);
      current = await this.getJob(current.id);
    }
    if (current.status !== "completed") throw new Error(current.error || `Video job ${current.id} ended with status ${current.status}`);
    return current;
  }

  async getJob(jobId: string): Promise<VideoJob> {
    const response = await fetch(`${this.config.baseUrl}/videos/${jobId}`, { headers: this.headers() });
    const json = await this.readJson(response);
    if (!response.ok) throw new Error(this.errorMessage(json, response.status));
    return this.parseJob(json);
  }

  async download(job: VideoJob, outputPath: string): Promise<void> {
    const url = job.contentUrl ?? `${this.config.baseUrl}/videos/${job.id}/content`;
    const response = await fetch(url.startsWith("http") ? url : `${this.config.baseUrl}${url}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Failed to download video ${job.id}: ${response.status} ${response.statusText}`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  }

  private headers(extra: Record<string, string> = {}): HeadersInit {
    return {
      authorization: `Bearer ${this.config.openRouterApiKey}`,
      "http-referer": "https://vorinthex.com",
      "x-title": "Vorinthex Local Asset Engine",
      ...extra
    };
  }

  private async referenceImageUrl(referenceImage: string): Promise<string> {
    if (/^https?:\/\//i.test(referenceImage) || /^data:image\//i.test(referenceImage)) return referenceImage;
    const absolutePath = path.resolve(this.config.rootDir, "..", "..", referenceImage);
    const file = Bun.file(absolutePath);
    if (!await file.exists()) throw new Error(`Reference image not found: ${referenceImage}`);
    const extension = path.extname(absolutePath).toLowerCase();
    const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
    const bytes = await file.bytes();
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text };
    }
  }

  private parseJob(json: unknown): VideoJob {
    const source = ((json as UnknownRecord).data ?? json) as UnknownRecord;
    const id = String(source.id ?? source.job_id ?? source.generation_id ?? "");
    if (!id) throw new Error("OpenRouter video response did not include a job id.");
    return {
      id,
      status: String(source.status ?? "pending"),
      pollingUrl: typeof source.polling_url === "string" ? source.polling_url : undefined,
      contentUrl: typeof source.content_url === "string" ? source.content_url : undefined,
      error: typeof source.error === "string" ? source.error : undefined
    };
  }

  private errorMessage(json: unknown, status: number): string {
    const source = ((json as UnknownRecord).error ?? json) as UnknownRecord | string;
    if (typeof source === "string") return `${status} ${source}`;
    return `${status} ${String(source.message ?? JSON.stringify(json))}`;
  }
}
