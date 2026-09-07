import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import AdminPage, { metadata } from "./page";
import { mapAdminSession } from "./AdminClient";

describe("founder admin entry", () => {
  test("maps only 200 to authenticated and 401/403 to the founder gate", () => {
    expect(mapAdminSession(200, { user: { name: "Ada" }, rootTeam: { name: "Vorinthex" }, rootTeamMembership: { role: "owner" } })).toMatchObject({ kind: "authenticated", account: { rootTeam: { name: "Vorinthex" }, rootTeamMembership: { role: "owner" } } });
    expect(mapAdminSession(401, { error: "no" })).toEqual({ kind: "signed-out" });
    expect(mapAdminSession(403, { error: "no" })).toEqual({ kind: "signed-out" });
    expect(mapAdminSession(500, null)).toEqual({ kind: "error" });
    expect(mapAdminSession(200, {})).toEqual({ kind: "error" });
  });

  test("is private metadata and starts with a non-disclosing access check", () => {
    expect(metadata.robots).toContain("noindex");
    expect(metadata.robots).toContain("noarchive");
    const html = renderToStaticMarkup(AdminPage());
    expect(html).toContain("Checking access");
    expect(html).not.toContain("Founder gate is open");
  });
});
