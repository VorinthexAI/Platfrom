# syntax=docker/dockerfile:1

FROM oven/bun:1-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Retry: under QEMU-emulated arm64 builds, bun install occasionally fails
# mid-extraction on a transient tarball read ("Fail extracting tarball for
# fb-dotslash") — a known emulation flake, not a real dependency problem. A
# clean retry succeeds every time this has been seen.
FROM base AS deps
COPY backend/package.json backend/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
	for i in 1 2 3; do \
		if bun install --frozen-lockfile --production; then break; fi; \
		echo "bun install failed (attempt $i/3), retrying..."; \
		if [ "$i" = 3 ]; then exit 1; fi; \
		sleep 5; \
	done

FROM base AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY backend/package.json backend/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
	for i in 1 2 3; do \
		if bun install --frozen-lockfile; then break; fi; \
		echo "bun install failed (attempt $i/3), retrying..."; \
		if [ "$i" = 3 ]; then exit 1; fi; \
		sleep 5; \
	done
ENTRYPOINT ["bun", "run"]
CMD ["--hot", "src/api/index.ts"]

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV SHARED_DIR=/shared
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json backend/tsconfig.json ./
COPY backend/src ./src
COPY shared /shared
USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["bun", "run"]
CMD ["src/api/index.ts"]

