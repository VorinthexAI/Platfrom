import path from "node:path";
import type { AudioAsset, AudioCategory, AudioVersion } from "./types";
import { audioRegistrySchema } from "./types";
import { readJson, writeJson } from "./filesystem";
import { nowIso } from "./utils";

export class AudioRegistryStore {
  private readonly registryPath: string;

  constructor(private readonly rootDir: string) {
    this.registryPath = path.join(rootDir, "registry/audio.json");
  }

  async list(): Promise<AudioAsset[]> {
    return audioRegistrySchema.parse(await readJson(this.registryPath, { audio: [] })).audio;
  }

  async save(audio: AudioAsset[]): Promise<void> {
    audioRegistrySchema.parse({ audio });
    await writeJson(this.registryPath, { audio });
  }

  async createAsset(input: {
    slug: string;
    name: string;
    category: AudioCategory;
    entityId?: string;
    description?: string;
  }): Promise<AudioAsset> {
    const audio = await this.list();
    const existing = audio.find((asset) => asset.slug === input.slug);
    if (existing) return existing;
    const now = nowIso();
    const asset: AudioAsset = {
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
    await this.save([...audio, asset].sort((a, b) => a.slug.localeCompare(b.slug)));
    return asset;
  }

  async upsert(asset: AudioAsset): Promise<void> {
    const audio = await this.list();
    const next = audio.filter((entry) => entry.slug !== asset.slug);
    await this.save([...next, { ...asset, updatedAt: nowIso() }].sort((a, b) => a.slug.localeCompare(b.slug)));
  }

  async addVersion(asset: AudioAsset, input: Omit<AudioVersion, "id" | "version" | "createdAt">): Promise<AudioVersion> {
    const nextNumber = Math.max(0, ...asset.versions.map((version) => version.version)) + 1;
    const version: AudioVersion = {
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
