// migrations/001-initial-universe-schema.js  (arangojs-flavored pseudocode)
//
// REFERENCE SKETCH ONLY — NOT AN EXECUTABLE MIGRATION IN THIS REPO.
//
// Lifted close to verbatim from neural-map.md §46 "Database Migration
// Reference (Collection & Index Setup)". This describes a concrete, ordered
// migration for provisioning the collections/indexes described in §10.2/
// §10.3 of the plan. It is explicitly backend-owned — no `arangojs` (or any
// ArangoDB driver) is installed in this repo, and this file is not wired
// into any build/test/deploy step here. It's included in this frontend repo
// purely for frontend-team visibility, so the exact indexes this plan's
// query patterns (§10.4, §35) depend on existing have an obvious, versioned
// place to check, and so a schema regression (Risk #6, §19) has an obvious
// first place to look.
//
// `MAX_TIER` should be set based on Phase 0's spike results (§18) and the
// expected launch-scale graph size (§24, Open Question #4) — this plan does
// not hardcode a specific tier count, since it's a tuning parameter, not an
// architectural constant. It is intentionally left undefined here (would
// throw if `up`/`down` were actually invoked) since picking a placeholder
// value would misrepresent this as a tuned, ready-to-run migration.

async function up(db) {
  const nodes = await db.createCollection("nodes");
  await nodes.ensureIndex({ type: "persistent", fields: ["gridCell"], name: "idx_nodes_gridCell" });
  await nodes.ensureIndex({ type: "persistent", fields: ["type"], name: "idx_nodes_type" });
  await nodes.ensureIndex({ type: "persistent", fields: ["tenantId", "gridCell"], name: "idx_nodes_tenant_gridCell" }); // §15.2 — tenant-scoped variant of the spatial index, likely the ACTUAL primary index once multi-tenancy is confirmed (§24 Q1)

  const edges = await db.createEdgeCollection("edges");
  await edges.ensureIndex({ type: "persistent", fields: ["type"], name: "idx_edges_type" });
  // ArangoDB auto-creates the edge index (_from/_to) on edge collections — no
  // explicit ensureIndex call needed for basic _from/_to lookups.

  for (let tier = 0; tier <= MAX_TIER; tier++) {
    const tierCollection = await db.createCollection(`node_clusters_L${tier}`);
    await tierCollection.ensureIndex({ type: "persistent", fields: ["gridCell"], name: `idx_clusters_L${tier}_gridCell` });
    await tierCollection.ensureIndex({ type: "persistent", fields: ["tier"], name: `idx_clusters_L${tier}_tier` });
  }

  await db.createView("nodesSearchView", {
    type: "arangosearch",
    links: {
      nodes: {
        fields: {
          label: { analyzers: ["text_en"] },
          type: { analyzers: ["identity"] },
        },
      },
    },
  }); // §10.7

  // Auth/chat collections (§4, §7.2) — listed for completeness, not this
  // plan's primary focus.
  await db.createCollection("users");
  await db.createCollection("sessions");
  await db.createCollection("mfa_factors");
  await db.createCollection("chat_threads");
  await db.createCollection("chat_messages");
}

async function down(db) {
  // Reverse order — drop dependent collections/views before their targets.
  await db.dropView("nodesSearchView");
  for (let tier = MAX_TIER; tier >= 0; tier--) {
    await db.collection(`node_clusters_L${tier}`).drop();
  }
  await db.collection("edges").drop();
  await db.collection("nodes").drop();
  await db.collection("chat_messages").drop();
  await db.collection("chat_threads").drop();
  await db.collection("mfa_factors").drop();
  await db.collection("sessions").drop();
  await db.collection("users").drop();
}

module.exports = { up, down };
