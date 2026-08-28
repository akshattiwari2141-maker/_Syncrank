import type { FastifyInstance } from 'fastify'
import { prisma } from '@syncrank/db'
import { Readable } from 'node:stream'

const INACTIVE_THRESHOLD_DAYS = 14
const CSV_BATCH_SIZE = 200

function escapeCsv(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Yields CSV header, then campus students ordered by currentSyncScore,
 * in DB-paginated batches (no full-table load into memory).
 */
async function* streamCsvRows(campusId: string): AsyncGenerator<string> {
  const header = [
    'rank',
    'name',
    'email',
    'branch',
    'grad_year',
    'cf_handle',
    'lc_username',
    'cf_rating',
    'lc_solved',
    'sync_score',
  ]
  yield header.join(',') + '\n'

  let skip = 0
  let rank = 0

  for (;;) {
    const users = await prisma.user.findMany({
      where: { campusId, role: 'student' },
      orderBy: [{ currentSyncScore: 'desc' }, { id: 'asc' }],
      skip,
      take: CSV_BATCH_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        branch: true,
        gradYear: true,
        currentSyncScore: true,
        handleLink: {
          select: { cfHandle: true, lcUsername: true },
        },
      },
    })

    if (users.length === 0) break

    const snaps = await prisma.ratingSnapshot.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      orderBy: { createdAt: 'desc' },
      distinct: ['userId'],
      select: {
        userId: true,
        cfRating: true,
        lcSolvedTotal: true,
      },
    })
    const snapByUser = new Map(snaps.map((s) => [s.userId, s]))

    for (const u of users) {
      rank += 1
      const snap = snapByUser.get(u.id)
      const line = [
        rank,
        u.name,
        u.email,
        u.branch ?? '',
        u.gradYear ?? '',
        u.handleLink?.cfHandle ?? '',
        u.handleLink?.lcUsername ?? '',
        snap?.cfRating ?? '',
        snap?.lcSolvedTotal ?? '',
        u.currentSyncScore,
      ]
        .map(escapeCsv)
        .join(',')
      yield line + '\n'
    }

    skip += users.length
    if (users.length < CSV_BATCH_SIZE) break
  }
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/stats', { preHandler: app.requireRole('campus_admin') }, async (req, reply) => {
    const campusId = req.user!.campusId
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const inactiveThreshold = new Date(now.getTime() - INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000)

    const [studentsTotal, activeLast24h, inactive14d] = await Promise.all([
      prisma.user.count({ where: { campusId, role: 'student' } }),
      prisma.handleLink.count({
        where: { user: { campusId, role: 'student' }, lastSyncedAt: { gte: oneDayAgo } },
      }),
      prisma.handleLink.count({
        where: {
          user: { campusId, role: 'student' },
          OR: [{ lastSyncedAt: { lt: inactiveThreshold } }, { lastSyncedAt: null }],
        },
      }),
    ])

    return reply.send({ studentsTotal, activeLast24h, inactive14d })
  })

  app.get('/admin/inactive', { preHandler: app.requireRole('campus_admin') }, async (req, reply) => {
    const campusId = req.user!.campusId
    const inactiveThreshold = new Date(Date.now() - INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000)

    const users = await prisma.user.findMany({
      where: {
        campusId,
        role: 'student',
        handleLink: {
          OR: [{ lastSyncedAt: { lt: inactiveThreshold } }, { lastSyncedAt: null }],
        },
      },
      include: { handleLink: true },
      orderBy: { name: 'asc' },
    })

    const rows = users.map((u) => {
      const lastSyncedAt = u.handleLink?.lastSyncedAt ?? null
      const daysInactive = lastSyncedAt
        ? Math.floor((Date.now() - lastSyncedAt.getTime()) / (24 * 60 * 60 * 1000))
        : null
      return { id: u.id, name: u.name, email: u.email, daysInactive }
    })

    return reply.send({ rows })
  })

  app.get('/admin/contests', { preHandler: app.requireRole('campus_admin') }, async (req, reply) => {
    const contests = await prisma.contest.findMany({
      where: { campusId: req.user!.campusId },
      orderBy: { createdAt: 'desc' },
      include: { problems: true, _count: { select: { registrations: true } } },
    })
    return reply.send({ contests })
  })

  app.get('/admin/export.csv', { preHandler: app.requireRole('campus_admin') }, async (req, reply) => {
    const campusId = req.user!.campusId

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header(
      'Content-Disposition',
      `attachment; filename="syncrank-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    )

    return reply.send(Readable.from(streamCsvRows(campusId)))
  })
}