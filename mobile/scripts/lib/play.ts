import { createPrivateKey, sign } from "node:crypto";
import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { GoogleCredentials } from "./config";

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export type CountryAvailability = {
  syncWithProduction?: boolean;
  countries?: Array<{ countryCode: string }>;
  restOfWorld?: boolean;
};

/**
 * Thin Google Play Developer API (androidpublisher v3) client using a
 * service account (RS256 JWT -> OAuth token). All listing changes happen
 * inside an edit that is committed atomically at the end.
 */
export class PlayClient {
  private tokenValue: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly creds: GoogleCredentials) {}

  private async token(): Promise<string> {
    // Keyless mode: a pre-minted OAuth token (e.g. from gcloud service
    // account impersonation) is used as-is.
    if (this.creds.kind === "accessToken") return this.creds.accessToken;

    const now = Math.floor(Date.now() / 1000);
    if (this.tokenValue && now < this.tokenExpiresAt - 60) return this.tokenValue;

    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({ iss: this.creds.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    );
    const signature = sign(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      createPrivateKey(this.creds.privateKey),
    );
    const assertion = `${header}.${payload}.${base64url(signature)}`;

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const json = (await response.json()) as { access_token?: string; error_description?: string };
    if (!response.ok || !json.access_token) {
      throw new Error(`Play token exchange failed: ${json.error_description ?? response.status}`);
    }
    this.tokenValue = json.access_token;
    this.tokenExpiresAt = now + 3500;
    return this.tokenValue;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body ? { "Content-Type": contentType ?? "application/json" } : {}),
      },
      body:
        body === undefined
          ? undefined
          : contentType
            ? (body as Blob)
            : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Play ${method} ${url.replace(API, "")} -> ${response.status}: ${text.slice(0, 800)}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /* -------------------------------------------------------------- */

  async createEdit(packageName: string): Promise<string> {
    const edit = await this.request<{ id: string }>(
      "POST",
      `${API}/applications/${packageName}/edits`,
      {},
    );
    return edit.id;
  }

  async commitEdit(packageName: string, editId: string): Promise<void> {
    await this.request("POST", `${API}/applications/${packageName}/edits/${editId}:commit`, {});
  }

  async validateEdit(packageName: string, editId: string): Promise<void> {
    await this.request("POST", `${API}/applications/${packageName}/edits/${editId}:validate`, {});
  }

  async updateDetails(
    packageName: string,
    editId: string,
    details: { contactEmail: string; contactWebsite: string; defaultLanguage: string },
  ): Promise<void> {
    await this.request("PUT", `${API}/applications/${packageName}/edits/${editId}/details`, details);
  }

  async updateListing(
    packageName: string,
    editId: string,
    language: string,
    listing: { title: string; shortDescription: string; fullDescription: string; video?: string },
  ): Promise<void> {
    await this.request(
      "PUT",
      `${API}/applications/${packageName}/edits/${editId}/listings/${language}`,
      { language, ...listing },
    );
  }

  /** Delete-all then upload each file for one image type of one language. */
  async replaceImages(
    packageName: string,
    editId: string,
    language: string,
    imageType: string,
    files: string[],
  ): Promise<number> {
    const base = `${API}/applications/${packageName}/edits/${editId}/listings/${language}/${imageType}`;
    await this.request("DELETE", base);
    for (const file of files) {
      const mime = extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
      await this.request(
        "POST",
        `${UPLOAD_API}/applications/${packageName}/edits/${editId}/listings/${language}/${imageType}?uploadType=media`,
        Bun.file(file),
        mime,
      );
    }
    return files.length;
  }

  /**
   * Country availability is READ-ONLY in the public API (GET
   * edits.countryavailability) — Google offers no write endpoint, so the
   * submit script diffs current vs desired and prints a Console checklist.
   */
  async getCountryAvailability(
    packageName: string,
    editId: string,
    track: string,
  ): Promise<CountryAvailability> {
    return this.request<CountryAvailability>(
      "GET",
      `${API}/applications/${packageName}/edits/${editId}/countryAvailability/${track}`,
    );
  }
}

/** Sorted image files (png/jpg) inside a directory; [] when missing. */
export function imageFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function fileLabel(path: string): string {
  return basename(path);
}
