import { prisma } from '@syncrank/db'
import { logger } from '../lib/logger.js'

interface LatestSnapshotRow {
  id: string
  userId: string
  campusId: string
  syncScore: number
}

/**
 * Recomputes campusRank (and a simple globalRank) on the latest
 * RatingSnapshot per user, for every campus that had at least one sync
 * complete in this batch. Called after a batch of sync jobs finishes
 * rather than after every single job — ranks shifting by one position
 * after every individual sync would be noisy and wasteful to write.
 */
export async function recomputeCampusRanks(campusIds: string[]): Promise<void> {
  const uniqueCampusIds = [...new Set(campusIds)]

  for (const campusId of uniqueCampusIds) {
    const users = await prisma.user.findMany({
      where: { campusId, role: 'student' },
      select: { id: true },
    })
    const userIds = users.map((u: { id: string }) => u.id)
    if (userIds.length === 0) continue

    const latestPerUser = await prisma.ratingSnapshot.findMany({
      where: { userId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['userId'],
    })

    const rows = (latestPerUser as Array<{ id: string; userId: string; syncScore: number }>)
      .map((s) => ({ id: s.id, userId: s.userId, campusId, syncScore: s.syncScore }))
      .sort((a, b) => b.syncScore - a.syncScore)

    await prisma.$transaction(
      rows.map((row, i) => prisma.ratingSnapshot.update({ where: { id: row.id }, data: { campusRank: i + 1 } })),
    )

    logger.info({ msg: 'recomputed campus ranks', campusId, studentsRanked: rows.length })
  }

  await recomputeGlobalRanks()
}

async function recomputeGlobalRanks(): Promise<void> {
  const allStudents = await prisma.user.findMany({ where: { role: 'student' }, select: { id: true } })
  const userIds = allStudents.map((u: { id: string }) => u.id)
  if (userIds.length === 0) return

  const latestPerUser = await prisma.ratingSnapshot.findMany({
    where: { userId: { in: userIds } },
    orderBy: { createdAt: 'desc' },
    distinct: ['userId'],
  })

  const rows = (latestPerUser as Array<{ id: string; syncScore: number }>).sort((a, b) => b.syncScore - a.syncScore)

  // Batched in chunks to avoid one enormous transaction on large campuses —
  // 500 at a time keeps individual transactions reasonably sized.
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    await prisma.$transaction(
      chunk.map((row, j) => prisma.ratingSnapshot.update({ where: { id: row.id }, data: { globalRank: i + j + 1 } })),
    )
  }

  logger.info({ msg: 'recomputed global ranks', studentsRanked: rows.length })
}
