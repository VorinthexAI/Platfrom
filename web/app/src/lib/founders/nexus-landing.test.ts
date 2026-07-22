import { describe, expect, test } from "bun:test";
import { entityLogoUrl } from "@/lib/three/entity-logo";
import { NEXUS_HQ_ENTITY_ID, NEXUS_HQ_TRANSIT_DESTINATION } from "./nexus-landing";

describe("Nexus founder landing", () => {
  test("starts founders in headquarters", () => {
    expect(NEXUS_HQ_ENTITY_ID).toBe("product.hq");
    expect(NEXUS_HQ_TRANSIT_DESTINATION).toBe("Nexus headquarters");
  });

  test("uses an existing texture for the procedural Nexus star", () => {
    expect(entityLogoUrl("star", "nexus")).toBe("/logos/vorinthex-mark.png");
  });
});
