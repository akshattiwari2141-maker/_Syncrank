# syntax=docker/dockerfile:1
FROM node:20-slim AS base
WORKDIR /repo
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* .npmrc* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/worker apps/worker
RUN npm run build -w packages/shared
RUN npm run prisma:generate -w packages/db
RUN npm run build -w apps/worker

FROM node:20-slim AS runtime
WORKDIR /repo
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 syncrank

ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/package.json ./apps/worker/package.json

USER syncrank

# No HTTP surface to health-check via curl — liveness is "process is running"
# at the orchestrator level (restart policy), which is standard for a
# queue-consumer worker with no exposed port.

CMD ["node", "apps/worker/dist/main.js"]
