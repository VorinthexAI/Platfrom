import path from "node:path";
import { nanoid } from "nanoid";
import { appendMarkdown, readJson, writeJson } from "./filesystem";
import {
  type AssetCategory,
  type AssetRecord,
  type AssetVersion,
  type ExportRecord,
  type LockLevel,
  type LockRecord,
  type RunRecord,
  exportsRegistrySchema,
  locksRegistrySchema,
  registrySchema,
  runsRegistrySchema
} from "./types";
import { nowIso, slugify } from "./utils";

export class RegistryStore {
  private readonly assetsPath: string;
  private readonly locksPath: string;
  private readonly runsPath: string;
  private readonly exportsPath: string;
  private readonly historyPath: string;
  private readonly lockedRulesPath: string;

  constructor(private readonly rootDir: string) {
    this.assetsPath = path.join(rootDir, "registry/assets.json");
    this.locksPath = path.join(rootDir, "registry/locks.json");
    this.runsPath = path.join(rootDir, "registry/runs.json");
    this.exportsPath = path.join(rootDir, "registry/exports.json");
    this.historyPath = path.join(rootDir, "memory/history.md");
    this.lockedRulesPath = path.join(rootDir, "memory/locked-rules.md");
  }

  async listAssets(): Promise<AssetRecord[]> {
    return registrySchema.parse(await readJson(this.assetsPath, { assets: [] })).assets;
  }

  async saveAssets(assets: AssetRecord[]): Promise<void> {
    registrySchema.parse({ assets });
    await writeJson(this.assetsPath, { assets });
  }

  async getAsset(slug: string): Promise<AssetRecord | undefined> {
    return (await this.listAssets()).find((asset) => asset.slug === slug || asset.id === slug);
  }

  async createAsset(input: {
    name: string;
    slug?: string;
    category: AssetCategory;
    description?: string;
    designIntent?: string;
  }): Promise<AssetRecord> {
    const assets = await this.listAssets();
    const slug = slugify(input.slug || input.name);
    const existing = assets.find((asset) => asset.slug === slug);
    if (existing) return existing;
    const now = nowIso();
    const asset: AssetRecord = {
      id: `${input.category}-${slug}`,
      slug,
      name: input.name,
      category: input.category,
      status: "draft",
      locked: Boolean((await this.getLocks())[slug]),
      lockedVersionId: (await this.getLocks())[slug]?.lockedVersionId,
      description: input.description,
      designIntent: input.designIntent,
      versions: [],
      createdAt: now,
      updatedAt: now
    };
    await this.saveAssets([...assets, asset]);
    await this.appendHistory(asset, "Created asset", input.description);
    return asset;
  }

  async upsertAsset(asset: AssetRecord): Promise<void> {
    const assets = await this.listAssets();
    const next = assets.filter((current) => current.id !== asset.id);
    await this.saveAssets([...next, { ...asset, updatedAt: nowIso() }].sort((a, b) => a.slug.localeCompare(b.slug)));
  }

  async addVersion(asset: AssetRecord, version: Omit<AssetVersion, "version" | "id" | "createdAt">): Promise<AssetVersion> {
    const nextVersionNumber = Math.max(0, ...asset.versions.map((entry) => entry.version)) + 1;
    const nextVersion: AssetVersion = {
      ...version,
      id: `v${nextVersionNumber}`,
      version: nextVersionNumber,
      createdAt: nowIso()
    };
    asset.versions.push(nextVersion);
    asset.currentVersionId = nextVersion.id;
    asset.status = nextVersion.rejected ? "rejected" : "reviewed";
    await this.upsertAsset(asset);
    await this.appendHistory(asset, `Generated ${nextVersion.id}`, version.notes, [
      version.solidPath ? `solid: ${version.solidPath}` : undefined,
      version.transparentPath ? `transparent: ${version.transparentPath}` : undefined,
      version.solidSvgPath ? `solid svg: ${version.solidSvgPath}` : undefined,
      version.transparentSvgPath ? `transparent svg: ${version.transparentSvgPath}` : undefined
    ].filter(Boolean) as string[]);
    return nextVersion;
  }

  async getLocks(): Promise<Record<string, LockRecord>> {
    return locksRegistrySchema.parse(await readJson(this.locksPath, {}));
  }

  async saveLocks(locks: Record<string, LockRecord>): Promise<void> {
    locksRegistrySchema.parse(locks);
    await writeJson(this.locksPath, locks);
  }

  async lockAsset(asset: AssetRecord, versionId: string, lockLevel: LockLevel, rules: string[]): Promise<void> {
    const locks = await this.getLocks();
    locks[asset.slug] = {
      assetId: asset.id,
      lockedVersionId: versionId,
      lockedAt: nowIso(),
      lockLevel,
      rules
    };
    asset.locked = true;
    asset.lockedVersionId = versionId;
    asset.status = "locked";
    await this.saveLocks(locks);
    await this.upsertAsset(asset);
    await appendMarkdown(this.lockedRulesPath, `\n## ${asset.name} (${asset.slug})\n\nLevel: ${lockLevel}\nVersion: ${versionId}\n\n${rules.map((rule) => `- ${rule}`).join("\n")}\n`);
    await this.appendHistory(asset, `Locked ${versionId}`, `Level: ${lockLevel}`);
  }

  async unlockAsset(asset: AssetRecord, reason: string): Promise<void> {
    const locks = await this.getLocks();
    delete locks[asset.slug];
    asset.locked = false;
    asset.lockedVersionId = undefined;
    if (asset.status === "locked") asset.status = "reviewed";
    await this.saveLocks(locks);
    await this.upsertAsset(asset);
    await this.appendHistory(asset, "Unlocked asset", reason);
  }

  async appendRun(run: RunRecord): Promise<void> {
    const runs = runsRegistrySchema.parse(await readJson(this.runsPath, []));
    runs.push(run);
    await writeJson(this.runsPath, runs);
  }

  async appendExport(entry: ExportRecord): Promise<void> {
    const exports = exportsRegistrySchema.parse(await readJson(this.exportsPath, []));
    exports.push(entry);
    await writeJson(this.exportsPath, exports);
  }

  async appendHistory(asset: Pick<AssetRecord, "name" | "slug">, action: string, notes?: string, paths: string[] = []): Promise<void> {
    const lines = [
      `## ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      "",
      `Asset: ${asset.name}`,
      `Action: ${action}`,
      notes ? `Notes: ${notes}` : undefined,
      paths.length > 0 ? "Paths:" : undefined,
      ...paths.map((entry) => `- ${entry}`),
      ""
    ].filter(Boolean);
    await appendMarkdown(this.historyPath, lines.join("\n"));
  }

  createRun(asset: AssetRecord, versionId: string, action: string): RunRecord {
    return {
      runId: nanoid(12),
      assetId: asset.id,
      versionId,
      action,
      createdAt: nowIso(),
      status: "started"
    };
  }
}
