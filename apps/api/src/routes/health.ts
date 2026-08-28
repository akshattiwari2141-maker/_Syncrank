import type { FastifyInstance } from 'fastify'
import { prisma } from '@syncrank/db'
import { redis } from '../lib/redis.js'

export async function healthRoutes(app: FastifyInstance) {
  // Liveness — "is the process up" — used by orchestrators to decide
  // whether to restart the container. Deliberately does no I/O.
  app.get('/health', async () => ({ status: 'ok' }))

  // Readiness — "can this instance actually serve traffic" — checks the
  // dependencies that matter (DB, Redis). Used by load balancers to decide
  // whether to route traffic to this instance.
  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = { db: 'ok', redis: 'ok' }

    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      checks.db = 'fail'
    }

    try {
      await redis.ping()
    } catch {
      checks.redis = 'fail'
    }

    const allOk = Object.values(checks).every((v) => v === 'ok')
    return reply.code(allOk ? 200 : 503).send({ status: allOk ? 'ready' : 'not_ready', checks })
  })
}
