# SyncRank

A campus-first competitive programming platform. Merges Codeforces + LeetCode
activity into one Sync Score, ranks students within their campus, and lets
campus admins run local contests with live standings.

This is a monorepo: a typed API + worker backend, and the existing React
frontend now wired to real endpoints for the core flows (auth, dashboard,
leaderboard, contest creation).

## Status

**What's real and working:**
- Full typed API (Fastify + TypeScript) — auth, handles, sync trigger, dashboard,
  campus + global leaderboards, contest CRUD/publish/register/submit/standings,
  admin stats/inactive-list/CSV export, health/ready checks. **Typechecks with
  zero errors.**
- Worker (BullMQ) — sync job processor (CF + LC, with retry/backoff), nightly
  scan, contest lifecycle scheduler (scheduled → live → completed), campus/global
  rank recompute. **Typechecks with zero errors.**
- `packages/shared` — versioned Sync Score pure function with **11 passing unit
  tests**, zod schemas used on every API boundary, shared queue contracts.
- Prisma schema — full data model, indexed for the queries that matter.
- Realtime — Socket.IO with cookie-based auth handshake, campus-scoped room
  joins, Redis pub/sub relay so the worker (a separate process) can push
  contest status changes into live rooms.
- Frontend — `/login`, `/register`, `/dashboard`, and `/leaderboards` are fully
  wired to the live API via TanStack Query, with real loading/error/empty
  states. `/admin/contests/new` posts to the real contest-creation endpoint.
  Auth bootstraps from `GET /auth/me` on load; protected routes redirect to
  `/login` when unauthenticated.
- Docker — multi-stage Dockerfiles for api/worker/web, `docker-compose.yml`
  for local/staging parity, `docker-compose.prod.yml` for a managed-DB deploy.
- CI — GitHub Actions: install, typecheck, unit tests, migrate against a real
  Postgres service container, build all packages, smoke-test `/health`.

**What's honestly not done:**
- Arena, Profile, and Admin's contest list still render from `mockData.js` —
  the API endpoints they need (`GET /contests`, `GET /me/profile`,
  `GET /admin/contests`) exist and work, but the frontend wiring for those
  three specific pages wasn't finished. Follow the pattern in
  `DashboardPage.jsx` / `LeaderboardPage.jsx` to finish them — it's the same
  shape (TanStack Query + loading/error/empty).
- No integration test against a real DB beyond the CI smoke test (`/health`,
  `/ready`). Given more time, the next thing worth adding is a Vitest suite
  that spins up against the CI Postgres service and exercises
  register → login → link handle → leaderboard.
- Mentorship, recruiters, sponsored contests, mock interviews, teams, and the
  public developer API are explicitly out of scope for v1 (per the product
  spec) — their pages exist as visual stubs on mock data and are not wired
  to any backend. Don't be surprised that they still work in the UI; they're
  intentionally unauthenticated demo pages, not broken integrations.
- **`prisma generate` / `prisma validate` / `prisma migrate` have not been run
  or verified in the environment this was built in** — that sandbox's network
  allowlist blocks `binaries.prisma.sh`, which Prisma's CLI needs to download
  its native query engine. The schema was written and reviewed carefully by
  hand, but you should run `npm run prisma:generate` yourself as your first
  step and treat any errors it surfaces as real, not assume it's pre-verified.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the sync flow, live contest flow,
and data model in detail.

```
/apps
  /web     — React + Vite frontend
  /api     — Fastify + TypeScript REST API + Socket.IO
  /worker  — BullMQ job processors (sync, contest lifecycle)
/packages
  /shared  — zod schemas, Sync Score pure function, queue contracts
  /db      — Prisma schema, migrations, seed (generates one client both api and worker import)
```

## Local setup

Requires Docker (or local Postgres 16 + Redis 7 if you'd rather run those
outside containers) and Node 20+.

```bash
git clone <this repo>
cd syncrank
cp .env.example .env
# Edit .env — at minimum set a real JWT_SECRET:
#   openssl rand -base64 48

npm install

# Start Postgres + Redis (skip if you're running them yourself)
docker compose up -d postgres redis

# Generate the Prisma client, run migrations, seed demo data
npm run prisma:generate
npm run prisma:migrate:dev
npm run prisma:seed

# Run everything
npm run dev:api      # http://localhost:4000
npm run dev:worker
npm run dev:web       # http://localhost:5173
```

Or run the whole stack in Docker:

```bash
docker compose up --build
docker compose exec api npm run prisma:migrate:deploy -w packages/db
docker compose exec api npm run prisma:seed -w packages/db
```

Seeded accounts (see `packages/db/prisma/seed.ts`):
- Admin: `admin@srm.demo` / `AdminPass123!`
- Any seeded student, e.g. `riya@srm.demo` / `StudentPass123!`

## Production deploy

Recommended path: managed Postgres + Redis (Neon/Supabase + Upstash, or your
cloud provider's managed add-ons), API + worker as containers on Railway /
Render / Fly.io / a VPS, frontend on the same VPS behind nginx or on Vercel.

```bash
# On your deploy target, with a real .env (COOKIE_SECURE=true, real
# JWT_SECRET, DATABASE_URL/REDIS_URL pointing at managed instances):
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm api npm run prisma:migrate:deploy -w packages/db
docker compose -f docker-compose.prod.yml up -d
```

Reverse proxy notes if you're fronting with nginx yourself instead of a
platform's built-in proxy:
- Forward `Upgrade`/`Connection` headers for the `/socket.io` path so the
  WebSocket upgrade succeeds.
- Terminate TLS at the proxy; set `COOKIE_SECURE=true` only once HTTPS is
  actually in front of the API, or the session cookie won't be sent.

The API's `GET /ready` endpoint checks DB + Redis connectivity — point your
platform's health check at that, not `/health` (which only confirms the
process is alive, not that it can serve real traffic).

## Demo walkthrough

1. Register a student account at `/register` (pick the seeded campus).
2. Go to `/profile`, link a Codeforces handle and/or LeetCode username.
3. Click "Sync now" on `/dashboard` — this queues a job the worker picks up
   within seconds; refresh to see your Sync Score and rank populate.
4. Log in as the seeded admin (`admin@srm.demo`), go to `/admin`, click
   "+ Create contest", fill in the form, add problems from the bank, publish.
5. As a student, register for the contest in `/arena` and submit against a
   problem (the submit endpoint records a verdict — there's no real code
   execution/judging in this MVP, per the spec's "controlled demo submit
   endpoint").
6. Standings update over the WebSocket connection without a page refresh.
7. As admin, download the CSV export from `/export`.

## FIXTURE_MODE

`FIXTURE_MODE=true` makes LeetCode sync always return deterministic fixture
data instead of hitting LeetCode's real (unofficial, frequently rate-limited
or IP-blocked) GraphQL endpoint. Codeforces sync always hits the real public
API regardless of this flag — CF has an official, stable API, so there's no
reason to fake it.

Use `FIXTURE_MODE=true` for local dev and demos where you don't want results
to depend on whether LeetCode is currently blocking your IP. **Never set it
to true in a real production deployment** — students would see fake solve
counts, not their real Sync Score.

## Tests

```bash
npm run test          # sync-score unit tests (packages/shared)
npm run typecheck      # all TS packages
```
