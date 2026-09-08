import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";

test("Android Firebase config matches the production application", () => {
  const path = resolve(import.meta.dir, "../../google-services.json");
  expect(existsSync(path)).toBe(true);
  const config = JSON.parse(readFileSync(path, "utf8")) as {
    project_info?: { project_id?: string };
    client?: Array<{ client_info?: { android_client_info?: { package_name?: string } } }>;
  };
  expect(config.project_info?.project_id).toBe("vorinthex-ai-6df8e");
  expect(config.client?.some((client) => client.client_info?.android_client_info?.package_name === "app.vorinthex.com")).toBe(true);
});
