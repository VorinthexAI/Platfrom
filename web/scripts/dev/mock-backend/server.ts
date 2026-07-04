// scripts/dev/mock-backend/server.ts
//
// Local mock backend (neural-map.md §26.2, §47) — a small, dependency-light
// Node `http` server (no Express, matching the plan's "dependency-light"
// framing) serving synthetic responses matching every contract in §11,
// §7.3, and §45, so frontend development is never blocked on real
// backend/ArangoDB availability.
//
// Run: `bun run mock-backend` (see package.json) or directly:
//   bun run scripts/dev/mock-backend/server.ts
// Listens on :4000 — matches NEXT_PUBLIC_API_BASE_URL's default (§26.1).
//
// DELIBERATELY ROUGH (§47): no real AI SDK v6 framing, no real WebSocket
// endpoint (`/universe/stream`, §11.4, is NOT implemented here — it 404s),
// no real MFA state machine, no real password/credential checking. Its only
// job is unblocking frontend iteration on the *shapes* this plan specifies,
// never simulating backend correctness/security behavior. NEVER point a
// deployed environment at this server.
//
// DEV-ONLY AUTH BYPASS: `POST /api/v1/auth/verify` accepts ANY syntactically
// valid 6-digit code as correct (no real TOTP validation happens at all) —
// "000000" is called out here explicitly as the easiest one to type by hand
// during manual testing. This endpoint provides ZERO real security and must
// never be mistaken for anything but a shape-matching stub.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateSeedGraph, DEV_FIXTURE_SEED_OPTIONS, type SeedGraphNode } from "../generate-seed-graph";
import { encodeTileResponse } from "./encode-tile";
import { decodeCellIds, gridCell } from "../../../src/lib/shared-spatial-index";

const PORT = 4000;

// ── Fixture data, built once at startup ─────────────────────────────────────

console.log(`Generating seed graph (seed="${DEV_FIXTURE_SEED_OPTIONS.seed}")...`);
const graph = generateSeedGraph(DEV_FIXTURE_SEED_OPTIONS);
console.log(`Seed graph ready: ${graph.nodes.length} nodes, ${graph.edges.length} edges.`);

const nodesByKey = new Map(graph.nodes.map((n) => [n._key, n]));

// Simple in-memory grid index: group nodes by their gridCell, computed
// lazily per requested tier and cached — uses the exact same cellSize(tier)
// formula the client engine uses (Risk #3 / ADR-003), imported from the
// shared isomorphic module rather than reimplemented here.
function buildGridIndex(nodes: SeedGraphNode[]) {
  const perTierCache = new Map<number, Map<string, SeedGraphNode[]>>();

  function forTier(tier: number): Map<string, SeedGraphNode[]> {
    let cellMap = perTierCache.get(tier);
    if (!cellMap) {
      cellMap = new Map();
      for (const node of nodes) {
        const cell = gridCell(tier, node.position);
        const bucket = cellMap.get(cell);
        if (bucket) bucket.push(node);
        else cellMap.set(cell, [node]);
      }
      perTierCache.set(tier, cellMap);
    }
    return cellMap;
  }

  return {
    query(tier: number, cellIds: string[]): SeedGraphNode[] {
      const cellMap = forTier(tier);
      const result: SeedGraphNode[] = [];
      for (const cellId of cellIds) {
        const bucket = cellMap.get(cellId);
        if (bucket) result.push(...bucket);
      }
      return result;
    },
  };
}

const gridIndex = buildGridIndex(graph.nodes);

// ── Tiny helpers ─────────────────────────────────────────────────────────────

type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  };
};

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string, details?: Record<string, unknown>) {
  const body: ApiErrorResponse = { error: { code, message, details } };
  sendJson(res, status, body);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses the `cells` query param into individual gridCell ids.
 *
 * §45's OpenAPI sketch describes `cells` as "comma-separated gridCell ids",
 * but `gridCell()` (src/lib/shared-spatial-index.ts) itself produces ids
 * shaped like `L{tier}:{cx},{cy},{cz}` — which ALSO contain commas, making a
 * plain comma join/split ambiguous. Resolved (client, proxy route, and this
 * mock server all agree) by using `shared-spatial-index.ts`'s
 * `encodeCellIds`/`decodeCellIds`, which join with `;` instead — see that
 * module for the full writeup.
 */
function parseCellIds(raw: string): string[] {
  return decodeCellIds(raw);
}

async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

// ── DEV-ONLY mock session/cookie handling ───────────────────────────────────
//
// Real session codec work belongs to src/server/auth/session-codec.ts (§4,
// owned by the auth agent) — this mock encodes `state:userId` in plain text
// directly in the cookie value, which is only acceptable because this server
// never runs anywhere but a developer's own machine.

type MockSessionState = "mfa_required" | "authenticated";
const SESSION_COOKIE_NAME = "vx_session";

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function readMockSession(req: IncomingMessage): { state: MockSessionState; userId: string } | null {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const [state, userId] = raw.split(":");
  if (state !== "mfa_required" && state !== "authenticated") return null;
  if (!userId) return null;
  return { state, userId };
}

function setMockSessionCookie(res: ServerResponse, state: MockSessionState, userId: string) {
  const value = encodeURIComponent(`${state}:${userId}`);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearMockSessionCookie(res: ServerResponse) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sessionJson(userId: string) {
  return {
    userId,
    displayName: userId.includes("@") ? userId.split("@")[0] : userId,
    avatarUrl: null,
    mfaLevel: "totp" as const,
  };
}

function userIdFromEmail(email: unknown): string {
  return typeof email === "string" && email.length > 0 ? email : "dev-user-1";
}

// ── Fake chat message fixtures (for GET /chat/threads/:id/messages) ────────

function fakeMessagesForThread(threadId: string) {
  const now = Date.now();
  return [
    {
      id: `${threadId}-m1`,
      threadId,
      role: "user" as const,
      parts: [{ kind: "text" as const, text: "What does this cluster represent?" }],
      createdAt: new Date(now - 60_000).toISOString(),
      status: "complete" as const,
    },
    {
      id: `${threadId}-m2`,
      threadId,
      role: "assistant" as const,
      parts: [{ kind: "text" as const, text: "This is a **mocked** historical reply for local development." }],
      createdAt: new Date(now - 55_000).toISOString(),
      status: "complete" as const,
    },
  ];
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;
    const method = req.method ?? "GET";

    if (pathname === "/api/v1/waitlist" && method === "POST") {
      const body = await readJsonBody<{ email?: unknown }>(req);
      if (typeof body.email !== "string" || !body.email.includes("@")) {
        sendJson(res, 400, { message: "Enter a valid email address." });
        return;
      }

      sendJson(res, 201, {
        ok: true,
        email: body.email.trim().toLowerCase(),
        verification_email_expires_in_hours: 48,
      });
      return;
    }

    if (pathname === "/api/v1/users/events" && method === "POST") {
      const body = await readJsonBody<{
        email_hash?: unknown;
        events?: unknown;
      }>(req);
      if (
        typeof body.email_hash !== "string" ||
        !body.email_hash ||
        !Array.isArray(body.events) ||
        body.events.length === 0
      ) {
        sendJson(res, 400, { message: "Invalid waitlist event payload." });
        return;
      }

      sendJson(res, 202, { ok: true });
      return;
    }

    if (pathname === "/api/v1/platform/events" && method === "POST") {
      const body = await readJsonBody<{
        distinctId?: unknown;
        slug?: unknown;
      }>(req);
      if (typeof body.distinctId !== "string" || typeof body.slug !== "string") {
        sendJson(res, 400, { message: "Invalid platform event payload." });
        return;
      }

      sendJson(res, 202, { ok: true });
      return;
    }

    if (pathname === "/api/v1/payments/checkout" && method === "POST") {
      const body = await readJsonBody<{
        email_hash?: unknown;
        product_id?: unknown;
      }>(req);
      if (
        typeof body.email_hash !== "string" ||
        !body.email_hash ||
        body.product_id !== "private.beta.access.ticket"
      ) {
        sendJson(res, 400, { message: "Invalid checkout payload." });
        return;
      }

      sendJson(res, 200, {
        checkout_url: `https://checkout.polar.sh/mock/private-beta-ticket?email_hash=${encodeURIComponent(
          body.email_hash,
        )}`,
      });
      return;
    }

    // ── universe/tiles ──
    if (pathname === "/api/v1/universe/tiles" && method === "GET") {
      const tier = Number(url.searchParams.get("tier") ?? "0");
      const cellIds = parseCellIds(url.searchParams.get("cells") ?? "");
      const pyramidVersion = url.searchParams.get("pyramidVersion") ?? DEV_FIXTURE_SEED_OPTIONS.seed;
      const matched = gridIndex.query(tier, cellIds);
      const buffer = encodeTileResponse({
        header: { tier, pyramidVersion, cellIds, nextChunkToken: null },
        nodes: matched,
      });
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(Buffer.from(buffer));
      return;
    }

    // ── universe/node/:id and universe/nodes/:id (alias — see §45 vs. this
    //    plan's task brief using slightly different singular/plural forms) ──
    const nodeMatch = pathname.match(/^\/api\/v1\/universe\/nodes?\/([^/]+)$/);
    if (nodeMatch && method === "GET") {
      const id = decodeURIComponent(nodeMatch[1]);
      const node = nodesByKey.get(id);
      if (!node) {
        sendError(res, 404, "NODE_NOT_FOUND", `No node with id "${id}".`);
        return;
      }
      const neighborCount = graph.edges.filter(
        (e) => e._from === `nodes/${id}` || e._to === `nodes/${id}`,
      ).length;
      sendJson(res, 200, {
        id: node._key,
        label: node.label,
        type: node.type,
        properties: node.properties,
        neighborCount,
      });
      return;
    }

    // ── universe/nodes/:id/neighbors ──
    const neighborsMatch = pathname.match(/^\/api\/v1\/universe\/nodes?\/([^/]+)\/neighbors$/);
    if (neighborsMatch && method === "GET") {
      const id = decodeURIComponent(neighborsMatch[1]);
      const CAP = 200;
      const neighborIds = new Set<string>();
      for (const edge of graph.edges) {
        if (edge._from === `nodes/${id}`) neighborIds.add(edge._to.replace(/^nodes\//, ""));
        else if (edge._to === `nodes/${id}`) neighborIds.add(edge._from.replace(/^nodes\//, ""));
        if (neighborIds.size >= CAP) break;
      }
      const truncated = neighborIds.size >= CAP;
      const neighbors = [...neighborIds]
        .map((nid) => nodesByKey.get(nid))
        .filter((n): n is SeedGraphNode => Boolean(n))
        .map((n) => ({ id: n._key, label: n.label, type: n.type, position: [n.position.x, n.position.y, n.position.z] }));
      sendJson(res, 200, { neighbors, truncated });
      return;
    }

    // ── universe/search ──
    if (pathname === "/api/v1/universe/search" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const results = graph.nodes
        .filter((n) => n.label.toLowerCase().includes(q))
        .slice(0, 20)
        .map((n) => ({ id: n._key, label: n.label, type: n.type, position: [n.position.x, n.position.y, n.position.z] }));
      sendJson(res, 200, results);
      return;
    }

    // ── universe/stream (realtime WS feed, §11.4) — not implemented ──
    if (pathname === "/api/v1/universe/stream") {
      sendError(res, 501, "NOT_IMPLEMENTED", "The mock backend does not implement the realtime WebSocket feed (§11.4).");
      return;
    }

    // ── chat/completions ──
    if (pathname === "/api/v1/chat/completions" && method === "POST") {
      // Minimal fake streaming response — enough to exercise the incremental
      // markdown renderer (§7.5) and scroll-anchor behavior (§7.6) in dev
      // without a real LLM call.
      const body = await readJsonBody<{ threadId?: string | null }>(req);
      const threadId = body.threadId || "mock-thread-1";
      res.writeHead(200, { "Content-Type": "text/event-stream", "X-Thread-Id": threadId });
      const tokens = "This is a **mocked** streaming response for local development.\n\n```ts\nconst x = 1;\n```".split(" ");
      for (const token of tokens) {
        res.write(`data: ${JSON.stringify({ type: "text-delta", delta: token + " " })}\n\n`);
        await sleep(40);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ── chat/threads/:threadId/messages ──
    const messagesMatch = pathname.match(/^\/api\/v1\/chat\/threads\/([^/]+)\/messages$/);
    if (messagesMatch && method === "GET") {
      const threadId = decodeURIComponent(messagesMatch[1]);
      const messages = threadId === "new" ? [] : fakeMessagesForThread(threadId);
      sendJson(res, 200, { messages, nextCursor: null });
      return;
    }

    // ── auth/login ──
    if (pathname === "/api/v1/auth/login" && method === "POST") {
      const body = await readJsonBody<{ email?: string; password?: string }>(req);
      const userId = userIdFromEmail(body.email);
      setMockSessionCookie(res, "mfa_required", userId);
      sendJson(res, 200, { state: "mfa_required" });
      return;
    }

    // ── auth/verify (DEV-ONLY: any syntactically valid 6-digit code passes) ──
    if (pathname === "/api/v1/auth/verify" && method === "POST") {
      const session = readMockSession(req);
      if (!session || session.state !== "mfa_required") {
        sendError(res, 401, "SESSION_EXPIRED", "No pending mfa_required session — call /auth/login first.");
        return;
      }
      const body = await readJsonBody<{ code?: string }>(req);
      const code = body.code ?? "";
      if (!/^[0-9]{6}$/.test(code)) {
        sendError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid code — dev mode accepts any 6-digit code (try 000000).", {
          attemptsRemaining: 4,
        });
        return;
      }
      setMockSessionCookie(res, "authenticated", session.userId);
      sendJson(res, 200, sessionJson(session.userId));
      return;
    }

    // ── auth/session ──
    if (pathname === "/api/v1/auth/session" && method === "GET") {
      const session = readMockSession(req);
      if (!session || session.state !== "authenticated") {
        sendError(res, 401, "SESSION_EXPIRED", "Not authenticated.");
        return;
      }
      sendJson(res, 200, sessionJson(session.userId));
      return;
    }

    // ── auth/logout ──
    if (pathname === "/api/v1/auth/logout" && method === "POST") {
      clearMockSessionCookie(res);
      sendJson(res, 200, {});
      return;
    }

    // ── auth/signup ──
    if (pathname === "/api/v1/auth/signup" && method === "POST") {
      const body = await readJsonBody<{ email?: string }>(req);
      const accountLabel = userIdFromEmail(body.email);
      const issuerLabel = "Vorinthex";
      // Fake but syntactically valid otpauth URI (dev-only — this secret is
      // not real and must never be treated as one).
      const otpauthUri = `otpauth://totp/${encodeURIComponent(issuerLabel)}:${encodeURIComponent(
        accountLabel,
      )}?secret=JBSWY3DPEHPK3PXP&issuer=${encodeURIComponent(issuerLabel)}`;
      // Simplest correct dev placeholder: an inline bordered-box SVG data URI
      // rather than a real QR-rendering dependency (no new dependency added).
      const qrSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
        `<rect width="200" height="200" fill="#14171B" stroke="#7C9CFF" stroke-width="4"/>` +
        `<text x="100" y="106" font-family="monospace" font-size="20" fill="#EDEFF2" text-anchor="middle">QR</text>` +
        `</svg>`;
      const qrCodeImageSrc = `data:image/svg+xml,${encodeURIComponent(qrSvg)}`;
      sendJson(res, 200, { otpauthUri, qrCodeImageSrc, accountLabel, issuerLabel });
      return;
    }

    // ── fallback ──
    sendError(res, 404, "NOT_FOUND", `No mock route for ${method} ${pathname}.`);
  } catch (err) {
    sendError(res, 500, "MOCK_SERVER_ERROR", err instanceof Error ? err.message : "Unknown mock server error.");
  }
});

server.listen(PORT, () => {
  console.log(`Mock backend listening on :${PORT} — matches NEXT_PUBLIC_API_BASE_URL default (§26.1)`);
  console.log(`DEV-ONLY: POST /api/v1/auth/verify accepts any 6-digit code (e.g. 000000) as valid.`);
});
