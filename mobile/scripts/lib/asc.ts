import { createHash, createPrivateKey, sign } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import type { AppleCredentials } from "./config";

const API = "https://api.appstoreconnect.apple.com";

/** App Store states that still accept metadata edits. */
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

type Resource = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
};

class AscApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AscApiError";
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function buildAppAvailabilityPayload(
  appId: string,
  configuredTerritoryIds: readonly string[],
  appleTerritoryIds: readonly string[],
  availableInNewTerritories = false,
): Record<string, unknown> {
  const configured = new Set(configuredTerritoryIds);
  const desiredTerritories = [...new Set(appleTerritoryIds)].filter((id) => configured.has(id));
  const missingTerritories = [...configured].filter((id) => !desiredTerritories.includes(id));
  if (missingTerritories.length > 0) {
    console.warn(
      `Skipping unavailable Apple territories: ${missingTerritories.sort().join(", ")}`,
    );
  }
  if (desiredTerritories.length === 0) {
    throw new Error("None of the configured Apple territories are currently available.");
  }

  const included = desiredTerritories.map((territory) => ({
    type: "territoryAvailabilities",
    id: `\${${territory}}`,
    attributes: { available: true },
    relationships: {
      territory: { data: { type: "territories", id: territory } },
    },
  }));

  return {
    data: {
      type: "appAvailabilities",
      attributes: { availableInNewTerritories },
      relationships: {
        app: { data: { type: "apps", id: appId } },
        territoryAvailabilities: {
          data: included.map(({ type, id }) => ({ type, id })),
        },
      },
    },
    included,
  };
}

/**
 * Thin App Store Connect API client. Auth is an ES256 JWT signed with the
 * .p8 API key (aud appstoreconnect-v1, max 20 minute lifetime).
 */
export class AscClient {
  private tokenValue: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly creds: AppleCredentials) {}

  private token(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.tokenValue && now < this.tokenExpiresAt - 60) return this.tokenValue;

    const header = base64url(JSON.stringify({ alg: "ES256", kid: this.creds.keyId, typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({
        iss: this.creds.issuerId,
        iat: now,
        exp: now + 19 * 60,
        aud: "appstoreconnect-v1",
      }),
    );
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
      key: createPrivateKey(this.creds.privateKey),
      dsaEncoding: "ieee-p1363",
    });
    this.tokenValue = `${header}.${payload}.${base64url(signature)}`;
    this.tokenExpiresAt = now + 19 * 60;
    return this.tokenValue;
  }

  async request<T = { data: Resource | Resource[] }>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) {
      let code: string | undefined;
      try {
        const payload = JSON.parse(text) as { errors?: Array<{ code?: string }> };
        code = payload.errors?.find((error) => error.code)?.code;
      } catch {
        // Preserve the raw response below when App Store Connect returns non-JSON.
      }
      throw new AscApiError(
        `ASC ${method} ${path} -> ${response.status}: ${text.slice(0, 800)}`,
        code,
      );
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  /* -------------------------------------------------------------- */

  async findApp(bundleId: string): Promise<Resource | null> {
    const result = await this.request<{ data: Resource[] }>(
      "GET",
      `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    );
    return result.data[0] ?? null;
  }

  /** Find an editable version or create one for versionString. */
  async ensureVersion(appId: string, versionString: string, releaseType: string): Promise<Resource> {
    const versions = await this.request<{ data: Resource[] }>(
      "GET",
      `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=20`,
    );
    const editable = versions.data.find((v) =>
      EDITABLE_STATES.has(String(v.attributes?.appStoreState ?? v.attributes?.appVersionState)),
    );
    if (editable) {
      if (editable.attributes?.versionString !== versionString) {
        await this.request("PATCH", `/v1/appStoreVersions/${editable.id}`, {
          data: {
            type: "appStoreVersions",
            id: editable.id,
            attributes: { versionString, releaseType },
          },
        });
      }
      return editable;
    }
    const created = await this.request<{ data: Resource }>("POST", "/v1/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString, releaseType },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return created.data;
  }

  /** Categories + name/subtitle/privacy URL per locale on the editable app info. */
  async updateAppInfo(
    appId: string,
    primaryCategory: string,
    secondaryCategory: string | undefined,
    localizations: Record<string, { name: string; subtitle?: string; privacyPolicyUrl: string }>,
  ): Promise<void> {
    const infos = await this.request<{ data: Resource[] }>("GET", `/v1/apps/${appId}/appInfos`);
    const editable =
      infos.data.find((info) =>
        ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED"].includes(
          String(info.attributes?.appStoreState ?? info.attributes?.state),
        ),
      ) ?? infos.data[0];
    if (!editable) throw new Error("No appInfos found for app");

    const categories: Record<string, unknown> = {
      primaryCategory: { data: { type: "appCategories", id: primaryCategory } },
    };
    if (secondaryCategory) {
      categories.secondaryCategory = { data: { type: "appCategories", id: secondaryCategory } };
    }
    await this.request("PATCH", `/v1/appInfos/${editable.id}`, {
      data: { type: "appInfos", id: editable.id, relationships: categories },
    });

    const existing = await this.request<{ data: Resource[] }>(
      "GET",
      `/v1/appInfos/${editable.id}/appInfoLocalizations`,
    );
    for (const [locale, values] of Object.entries(localizations)) {
      const current = existing.data.find((loc) => loc.attributes?.locale === locale);
      if (current) {
        await this.request("PATCH", `/v1/appInfoLocalizations/${current.id}`, {
          data: { type: "appInfoLocalizations", id: current.id, attributes: values },
        });
      } else {
        await this.request("POST", "/v1/appInfoLocalizations", {
          data: {
            type: "appInfoLocalizations",
            attributes: { locale, ...values },
            relationships: { appInfo: { data: { type: "appInfos", id: editable.id } } },
          },
        });
      }
    }
  }

  /** Description/keywords/support URL etc. per locale on a version. */
  async updateVersionLocalizations(
    versionId: string,
    localizations: Record<string, Record<string, unknown>>,
  ): Promise<Map<string, string>> {
    const existing = await this.request<{ data: Resource[] }>(
      "GET",
      `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    );
    const ids = new Map<string, string>();
    for (const [locale, attributes] of Object.entries(localizations)) {
      const { whatsNew, ...editableAttributes } = attributes;
      const current = existing.data.find((loc) => loc.attributes?.locale === locale);
      let localizationId: string;
      if (current) {
        await this.request("PATCH", `/v1/appStoreVersionLocalizations/${current.id}`, {
          data: {
            type: "appStoreVersionLocalizations",
            id: current.id,
            attributes: editableAttributes,
          },
        });
        localizationId = current.id;
      } else {
        const created = await this.request<{ data: Resource }>(
          "POST",
          "/v1/appStoreVersionLocalizations",
          {
            data: {
              type: "appStoreVersionLocalizations",
              attributes: { locale, ...editableAttributes },
              relationships: {
                appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
              },
            },
          },
        );
        localizationId = created.data.id;
      }

      if (typeof whatsNew === "string") {
        try {
          await this.request("PATCH", `/v1/appStoreVersionLocalizations/${localizationId}`, {
            data: {
              type: "appStoreVersionLocalizations",
              id: localizationId,
              attributes: { whatsNew },
            },
          });
        } catch (error) {
          if (error instanceof AscApiError && error.code === "STATE_ERROR") {
            console.warn(
              `  ${locale}: skipping whatsNew because the current App Store Connect state does not allow editing it.`,
            );
          } else {
            throw error;
          }
        }
      }
      ids.set(locale, localizationId);
    }
    return ids;
  }

  /**
   * Replace the screenshots of one display type for one localization:
   * reserve (POST appScreenshots) -> chunked upload (uploadOperations)
   * -> commit (PATCH uploaded + md5 sourceFileChecksum).
   */
  async replaceScreenshots(
    versionLocalizationId: string,
    displayType: string,
    dir: string,
  ): Promise<number> {
    const files = readdirSync(dir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f))
      .sort()
      .map((f) => join(dir, f));
    if (files.length === 0) return 0;

    const sets = await this.request<{ data: Resource[] }>(
      "GET",
      `/v1/appStoreVersionLocalizations/${versionLocalizationId}/appScreenshotSets`,
    );
    let set = sets.data.find((s) => s.attributes?.screenshotDisplayType === displayType);
    if (!set) {
      const created = await this.request<{ data: Resource }>("POST", "/v1/appScreenshotSets", {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: displayType },
          relationships: {
            appStoreVersionLocalization: {
              data: { type: "appStoreVersionLocalizations", id: versionLocalizationId },
            },
          },
        },
      });
      set = created.data;
    }

    const existing = await this.request<{ data: Resource[] }>(
      "GET",
      `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`,
    );
    for (const screenshot of existing.data) {
      await this.request("DELETE", `/v1/appScreenshots/${screenshot.id}`);
    }

    for (const file of files) {
      const bytes = readFileSync(file);
      const reservation = await this.request<{
        data: Resource & {
          attributes: {
            uploadOperations: Array<{
              method: string;
              url: string;
              offset: number;
              length: number;
              requestHeaders: Array<{ name: string; value: string }>;
            }>;
          };
        };
      }>("POST", "/v1/appScreenshots", {
        data: {
          type: "appScreenshots",
          attributes: { fileName: basename(file), fileSize: statSync(file).size },
          relationships: {
            appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } },
          },
        },
      });

      for (const op of reservation.data.attributes.uploadOperations) {
        const chunk = bytes.subarray(op.offset, op.offset + op.length);
        const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
        const upload = await fetch(op.url, { method: op.method, headers, body: chunk });
        if (!upload.ok) {
          throw new Error(`Screenshot chunk upload failed: ${upload.status} for ${file}`);
        }
      }

      await this.request("PATCH", `/v1/appScreenshots/${reservation.data.id}`, {
        data: {
          type: "appScreenshots",
          id: reservation.data.id,
          attributes: {
            uploaded: true,
            sourceFileChecksum: createHash("md5").update(bytes).digest("hex"),
          },
        },
      });
    }
    return files.length;
  }

  async replaceCreativePlacement(
    appId: string,
    versionLocalizationId: string,
    placementType: "PRODUCT_PAGE_HEADER_ASSET" | "APP_STORE_SEARCH_RESULTS_ASSET",
    file: string,
  ): Promise<void> {
    const bytes = readFileSync(file);
    const reservation = await this.request<{
      data: Resource & {
        attributes: {
          uploadOperations: Array<{
            method: string;
            url: string;
            offset: number;
            length: number;
            requestHeaders: Array<{ name: string; value: string }>;
          }>;
        };
      };
    }>("POST", "/v1/appAssetLibraryImages", {
      data: {
        type: "appAssetLibraryImages",
        attributes: { fileName: basename(file), fileSize: statSync(file).size, category: "CREATIVE_ASSETS" },
        relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: appId } } },
      },
    });

    for (const op of reservation.data.attributes.uploadOperations) {
      const chunk = bytes.subarray(op.offset, op.offset + op.length);
      const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
      const upload = await fetch(op.url, { method: op.method, headers, body: chunk });
      if (!upload.ok) throw new Error(`Creative asset chunk upload failed: ${upload.status} for ${file}`);
    }

    await this.request("PATCH", `/v1/appAssetLibraryImages/${reservation.data.id}`, {
      data: {
        type: "appAssetLibraryImages",
        id: reservation.data.id,
        attributes: { uploaded: true },
      },
    });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const image = await this.request<{ data: Resource }>("GET", `/v1/appAssetLibraryImages/${reservation.data.id}`);
      const state = String(image.data.attributes?.state ?? "");
      if (state === "PREPARE_FOR_SUBMISSION" || state === "COMPLETE" || state === "ACTIVE") break;
      if (state === "FAILED") throw new Error(`Creative asset failed: ${JSON.stringify(image.data.attributes?.stateDetails)}`);
      await Bun.sleep(2000);
    }

    const placements = await this.request<{ data: Resource[] }>(
      "GET",
      `/v1/appStoreVersionLocalizations/${versionLocalizationId}/placements?limit=50`,
    );
    for (const placement of placements.data) {
      if (placement.attributes?.placementType === placementType) {
        await this.request("DELETE", `/v1/appAssetLibraryPlacements/${placement.id}`);
      }
    }

    await this.request("POST", "/v1/appAssetLibraryPlacements", {
      data: {
        type: "appAssetLibraryPlacements",
        attributes: { placementType },
        relationships: {
          appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: versionLocalizationId } },
          image: { data: { type: "appAssetLibraryImages", id: reservation.data.id } },
        },
      },
    });
  }

  async setWorldwideAvailability(appId: string): Promise<string[]> {
    const existing = await this.request<{ data: Resource }>("GET", `/v1/apps/${appId}/appAvailabilityV2`).catch(() => null);
    if (!existing?.data?.id) {
      const territories = await this.request<{ data: Resource[] }>("GET", "/v1/territories?limit=200");
      const ids = territories.data.map((territory) => territory.id);
      await this.request("POST", "/v2/appAvailabilities", buildAppAvailabilityPayload(appId, ids, ids, true));
      return ids.sort();
    }
    const listed = await this.request<{ data: Resource[]; included?: Resource[] }>(
      "GET",
      `/v2/appAvailabilities/${existing.data.id}/territoryAvailabilities?include=territory&limit=200`,
    );
    for (const item of listed.data) {
      if (item.attributes?.available === true) continue;
      await this.request("PATCH", `/v1/territoryAvailabilities/${item.id}`, {
        data: { type: "territoryAvailabilities", id: item.id, attributes: { available: true } },
      });
    }
    return (listed.included ?? []).filter((item) => item.type === "territories").map((item) => item.id).sort();
  }

  async updateReviewDetails(
    versionId: string,
    review: {
      contactFirstName: string;
      contactLastName: string;
      contactPhone: string;
      contactEmail: string;
      demoAccountRequired: boolean;
      notes: string;
    },
  ): Promise<void> {
    const attributes = {
      contactFirstName: review.contactFirstName,
      contactLastName: review.contactLastName,
      contactPhone: review.contactPhone,
      contactEmail: review.contactEmail,
      demoAccountRequired: review.demoAccountRequired,
      notes: review.notes,
    };
    try {
      const existing = await this.request<{ data: Resource }>("GET", `/v1/appStoreVersions/${versionId}/appStoreReviewDetail`);
      await this.request("PATCH", `/v1/appStoreReviewDetails/${existing.data.id}`, {
        data: { type: "appStoreReviewDetails", id: existing.data.id, attributes },
      });
    } catch {
      await this.request("POST", "/v1/appStoreReviewDetails", {
        data: {
          type: "appStoreReviewDetails",
          attributes,
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
        },
      });
    }
  }

  /** Current territory ids, for the post-run report. */
  async getTerritoryAvailability(appId: string): Promise<string[]> {
    const result = await this.request<{
      data: Resource[];
      included?: Resource[];
    }>(
      "GET",
      `/v2/appAvailabilities/${appId}/territoryAvailabilities?include=territory&limit=200`,
    );
    return result.data
      .filter((item) => item.attributes?.available === true)
      .map((item) => item.id)
      .sort();
  }
}
