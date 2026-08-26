import type { FastifyInstance } from 'fastify'
import { LinkHandlesInput } from '@syncrank/shared'
import { prisma } from '@syncrank/db'
import { enqueueUserSync } from '../lib/queues.js'

export async function meRoutes(app: FastifyInstance) {
  app.post('/me/handles', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = LinkHandlesInput.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { cfHandle, lcUsername } = parsed.data
    const userId = req.user!.sub

    const link = await prisma.handleLink.upsert({
      where: { userId },
      update: { cfHandle, lcUsername, isStale: true },
      create: { userId, cfHandle, lcUsername, isStale: true },
    })

    // Linking a handle should trigger an immediate sync rather than making
    // the student wait for the nightly job.
    await enqueueUserSync(userId)

    return reply.send({ ok: true, handles: { cfHandle: link.cfHandle, lcUsername: link.lcUsername } })
  })

  app.post('/me/sync', { preHandler: app.requireAuth, config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const userId = req.user!.sub
    const link = await prisma.handleLink.findUnique({ where: { userId } })
    if (!link || (!link.cfHandle && !link.lcUsername)) {
      return reply.code(400).send({ error: 'Link at least one handle before syncing', code: 'NO_HANDLES_LINKED' })
    }

    await enqueueUserSync(userId)
    return reply.code(202).send({ ok: true, message: 'Sync queued' })
  })

  app.get('/me/dashboard', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.user!.sub

    const [user, latestSnapshot, upcomingContest] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, include: { handleLink: true, campus: true } }),
      prisma.ratingSnapshot.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      prisma.contest.findFirst({
        where: { campusId: req.user!.campusId, status: { in: ['scheduled', 'live'] } },
        orderBy: { startAt: 'asc' },
      }),
    ])

    if (!user) return reply.code(404).send({ error: 'User not found', code: 'USER_NOT_FOUND' })

    return reply.send({
      user: { id: user.id, name: user.name, campus: user.campus.name },
      handles: user.handleLink
        ? {
            cfHandle: user.handleLink.cfHandle,
            lcUsername: user.handleLink.lcUsername,
            lastSyncedAt: user.handleLink.lastSyncedAt,
            isStale: user.handleLink.isStale,
          }
        : null,
      snapshot: latestSnapshot
        ? {
            syncScore: latestSnapshot.syncScore,
            cfRating: latestSnapshot.cfRating,
            lcSolvedTotal: latestSnapshot.lcSolvedTotal,
            campusRank: latestSnapshot.campusRank,
            globalRank: latestSnapshot.globalRank,
            createdAt: latestSnapshot.createdAt,
          }
        : null,
      upcomingContest: upcomingContest
        ? { id: upcomingContest.id, title: upcomingContest.title, startAt: upcomingContest.startAt, status: upcomingContest.status }
        : null,
    })
  })

  app.get('/me/profile', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.user!.sub
    const history = await prisma.ratingSnapshot.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: 90,
    })
    return reply.send({ history })
  })
}
