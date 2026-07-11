# syntax=docker/dockerfile:1
#
# Web (Next standalone) image. BUILD CONTEXT MUST BE THE REPO ROOT so the bun
# workspace installs and Next's file-tracing can see @vorinthex/shared and the
# hoisted monorepo dependencies:
#
#   docker build -f web/app/Dockerfile -t vorinthex-web .
#
# Multi-arch / Graviton-ready: no native deps (images.unoptimized drops sharp),
# so `docker buildx build --platform linux/amd64,linux/arm64` works unchanged.

FROM oven/bun:1 AS builder
WORKDIR /repo

ARG NEXT_PUBLIC_SITE_URL=https://vorinthex.com
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the whole monorepo (the .dockerignore strips heavy/irrelevant paths and
# mirrors the CI content-strip). A full copy keeps bun workspace resolution
# correct across all workspaces.
COPY . .

# Retry: under QEMU-emulated arm64 builds, bun install occasionally fails
# mid-extraction on a transient tarball read ("Fail extracting tarball for
# fb-dotslash") — a known emulation flake, not a real dependency problem. A
# clean retry succeeds every time this has been seen.
RUN --mount=type=cache,target=/root/.bun/install/cache \
	for i in 1 2 3; do \
		if bun install --frozen-lockfile; then break; fi; \
		echo "bun install failed (attempt $i/3), retrying..."; \
		if [ "$i" = 3 ]; then exit 1; fi; \
		sleep 5; \
	done
RUN cd web/app && bun run build

# ---- Runtime -----------------------------------------------------------------
# node:22-slim runs the Next standalone server directly; multi-arch base image.
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# outputFileTracingRoot = workspace root, so the standalone tree is rooted at
# the repo and the server entrypoint lands at web/app/server.js. Static assets
# and public/ must be placed alongside it.
COPY --from=builder /repo/web/app/.next/standalone ./
COPY --from=builder /repo/web/app/.next/static ./web/app/.next/static
COPY --from=builder /repo/web/app/public ./web/app/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "web/app/server.js"]
