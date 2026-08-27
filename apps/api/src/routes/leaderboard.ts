import type { FastifyInstance } from 'fastify'
import { LeaderboardQuery } from '@syncrank/shared'
import { prisma } from '@syncrank/db'

interface LeaderboardRow {
  id: string
  name: string
  branch?: string | null
  gradYear?: number | null
  campusName?: string
  syncScore: number
  cfRating: number | null
  lcSolvedTotal: number | null
  rank: number
}

/** Latest snapshot stats for a small page of users only (not full table). */
async function latestSnapshotsByUser(
  userIds: string[],
): Promise<Map<string, { cfRating: number | null; lcSolvedTotal: number | null }>> {
  const result = new Map<string, { cfRating: number | null; lcSolvedTotal: number | null }>()
  if (userIds.length === 0) return result

  const latest = await prisma.ratingSnapshot.findMany({
    where: { userId: { in: userIds } },
    orderBy: { createdAt: 'desc' },
    distinct: ['userId'],
    select: { userId: true, cfRating: true, lcSolvedTotal: true },
  })

  for (const s of latest) {
    result.set(s.userId, { cfRating: s.cfRating, lcSolvedTotal: s.lcSolvedTotal })
  }
  return result
}

export async function leaderboardRoutes(app: FastifyInstance) {
  app.get('/campuses/:campusId/leaderboard', { preHandler: app.requireAuth }, async (req, reply) => {
    const { campusId } = req.params as { campusId: string }
    const parsed = LeaderboardQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { page, pageSize, year, branch } = parsed.data
    const skip = (page - 1) * pageSize

    const where = {
      campusId,
      role: 'student' as const,
      ...(year ? { gradYear: year } : {}),
      ...(branch ? { branch } : {}),
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ currentSyncScore: 'desc' }, { id: 'asc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          branch: true,
          gradYear: true,
          currentSyncScore: true,
        },
      }),
      prisma.user.count({ where }),
    ])

    const snaps = await latestSnapshotsByUser(users.map((u) => u.id))

    const rows: LeaderboardRow[] = users.map((u, i) => {
      const snap = snaps.get(u.id)
      return {
        id: u.id,
        name: u.name,
        branch: u.branch,
        gradYear: u.gradYear,
        syncScore: u.currentSyncScore,
        cfRating: snap?.cfRating ?? null,
        lcSolvedTotal: snap?.lcSolvedTotal ?? null,
        rank: skip + i + 1,
      }
    })

    return reply.send({ total, page, pageSize, rows })
  })

  app.get('/leaderboard/global', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = LeaderboardQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { page, pageSize } = parsed.data
    const skip = (page - 1) * pageSize
    const where = { role: 'student' as const }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ currentSyncScore: 'desc' }, { id: 'asc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          currentSyncScore: true,
          campus: { select: { name: true } },
        },
      }),
      prisma.user.count({ where }),
    ])

    const snaps = await latestSnapshotsByUser(users.map((u) => u.id))

    const rows: LeaderboardRow[] = users.map((u, i) => {
      const snap = snaps.get(u.id)
      return {
        id: u.id,
        name: u.name,
        campusName: u.campus.name,
        syncScore: u.currentSyncScore,
        cfRating: snap?.cfRating ?? null,
        lcSolvedTotal: snap?.lcSolvedTotal ?? null,
        rank: skip + i + 1,
      }
    })

    return reply.send({ total, page, pageSize, rows })
  })
}