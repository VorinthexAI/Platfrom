import path from "node:path";
import type { VideoAsset, VideoCategory, VideoVersion } from "./types";
import { videoRegistrySchema } from "./types";
import { readJson, writeJson } from "./filesystem";
import { nowIso } from "./utils";

export class VideoRegistryStore {
  private readonly registryPath: string;

  constructor(private readonly rootDir: string) {
    this.registryPath = path.join(rootDir, "registry/videos.json");
  }

  async list(): Promise<VideoAsset[]> {
    return videoRegistrySchema.parse(await readJson(this.registryPath, { videos: [] })).videos;
  }

  async save(videos: VideoAsset[]): Promise<void> {
    videoRegistrySchema.parse({ videos });
    await writeJson(this.registryPath, { videos });
  }

  async get(slug: string): Promise<VideoAsset | undefined> {
    return (await this.list()).find((asset) => asset.slug === slug);
  }

  async createAsset(input: {
    slug: string;
    name: string;
    category: VideoCategory;
    entityId?: string;
    description?: string;
  }): Promise<VideoAsset> {
    const videos = await this.list();
    const existing = videos.find((asset) => asset.slug === input.slug);
    if (existing) return existing;
    const now = nowIso();
    const asset: VideoAsset = {
      id: `${input.category}-${input.slug}`,
      slug: input.slug,
      name: input.name,
      category: input.category,
      entityId: input.entityId,
      description: input.description,
      versions: [],
      createdAt: now,
      updatedAt: now
    };
    await this.save([...videos, asset].sort((a, b) => a.slug.localeCompare(b.slug)));
    return asset;
  }

  async upsert(asset: VideoAsset): Promise<void> {
    const videos = await this.list();
    const next = videos.filter((entry) => entry.slug !== asset.slug);
    await this.save([...next, { ...asset, updatedAt: nowIso() }].sort((a, b) => a.slug.localeCompare(b.slug)));
  }

  async addVersion(asset: VideoAsset, input: Omit<VideoVersion, "id" | "version" | "createdAt">): Promise<VideoVersion> {
    const nextNumber = Math.max(0, ...asset.versions.map((version) => version.version)) + 1;
    const version: VideoVersion = {
      ...input,
      id: `v${nextNumber}`,
      version: nextNumber,
      createdAt: nowIso()
    };
    asset.versions.push(version);
    asset.currentVersionId = version.id;
    await this.upsert(asset);
    return version;
  }
}
