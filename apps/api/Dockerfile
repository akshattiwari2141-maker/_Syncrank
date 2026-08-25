# syntax=docker/dockerfile:1
FROM node:20-slim AS base
WORKDIR /repo
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# ---- deps: install full workspace deps once, reused by build stages ----
FROM base AS deps
COPY package.json package-lock.json* .npmrc* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

# ---- build: compile shared -> db (generate) -> api ----
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
RUN npm run build -w packages/shared
RUN npm run prisma:generate -w packages/db
RUN npm run build -w apps/api

# ---- runtime: minimal image, only what's needed to run ----
FROM node:20-slim AS runtime
WORKDIR /repo
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 syncrank

ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json

USER syncrank
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
