import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { randomUUID } from 'node:crypto'

import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { redis } from './lib/redis.js'
import authPlugin from './plugins/auth.js'
import { registerRealtime } from './realtime/socket.js'

import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { meRoutes } from './routes/me.js'
import { campusRoutes } from './routes/campuses.js'
import { leaderboardRoutes } from './routes/leaderboard.js'
import { contestRoutes } from './routes/contests.js'
import { adminRoutes } from './routes/admin.js'

async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      transport:
        env.NODE_ENV === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    genReqId: () => randomUUID(),
    trustProxy: true, // behind a reverse proxy (nginx/Cloud LB) in production
  })

  // ---- Security & platform basics ----
  await app.register(helmet, { contentSecurityPolicy: env.NODE_ENV === 'production' })
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })
  await app.register(cookie)
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis,
  })
  // Auth and sync routes declare their own tighter `config.rateLimit`
  // (see routes/auth.ts and routes/me.ts) which @fastify/rate-limit reads
  // automatically per-route — no need to double-register the plugin.

  await app.register(authPlugin)

  // ---- Consistent error shape everywhere, no stack traces in prod ----
  app.setErrorHandler((error, req, reply) => {
    req.log.error({ err: error }, 'unhandled error')
    const status = error.statusCode ?? 500
    const body =
      env.NODE_ENV === 'production' && status === 500
        ? { error: 'Internal server error', code: 'INTERNAL_ERROR' }
        : { error: error.message, code: error.code ?? 'ERROR' }
    reply.code(status).send(body)
  })

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'Route not found', code: 'NOT_FOUND' })
  })

  // ---- Routes ----
  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(meRoutes)
  await app.register(campusRoutes)
  await app.register(leaderboardRoutes)
  await app.register(contestRoutes)
  await app.register(adminRoutes)

  // ---- Realtime (Socket.IO mounted on the same HTTP server) ----
  registerRealtime(app)

  return app
}

async function main() {
  const app = await buildServer()

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    logger.info({ msg: 'SyncRank API listening', port: env.PORT, env: env.NODE_ENV, fixtureMode: env.FIXTURE_MODE })
  } catch (err) {
    logger.error({ msg: 'Failed to start server', err })
    process.exit(1)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      logger.info({ msg: `${signal} received, shutting down gracefully` })
      await app.close()
      process.exit(0)
    })
  }
}

main()
