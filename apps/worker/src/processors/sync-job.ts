import { prisma } from '@syncrank/db'
import { computeSyncScore, type SyncUserJobData } from '@syncrank/shared'
import type { Job } from 'bullmq'
import { fetchCfUserInfoWithRetry, CfApiError } from '../lib/cf-client.js'
import { fetchLcStats } from '../lib/lc-client.js'
import { logger } from '../lib/logger.js'

const MAX_RAW_PAYLOAD_BYTES = 20_000

type JsonSafe =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonSafe }
  | JsonSafe[]

function capPayload(payload: unknown): JsonSafe {
  const json = JSON.stringify(payload)
  if (json.length <= MAX_RAW_PAYLOAD_BYTES) return JSON.parse(json)
  return { truncated: true, preview: json.slice(0, MAX_RAW_PAYLOAD_BYTES) }
}

/**
 * Processes one user's sync: pulls CF + LC data (best-effort, independently
 * — one platform failing shouldn't block the other), computes the
 * versioned Sync Score, writes a new RatingSnapshot, denormalizes score
 * onto User for DB-level leaderboard pagination, and updates HandleLink
 * bookkeeping.
 */
export async function processSyncJob(job: Job<SyncUserJobData>): Promise<void> {
  const { userId } = job.data

  const link = await prisma.handleLink.findUnique({ where: { userId } })
  if (!link) {
    logger.warn({ msg: 'sync job for user with no HandleLink, skipping', userId })
    return
  }

  await prisma.syncJobLog.create({
    data: { userId, status: 'running', source: 'combined', attempt: job.attemptsMade + 1 },
  })

  let cfRating: number | null = null
  let cfError: string | null = null
  let cfRawPayload: unknown = null

  if (link.cfHandle) {
    try {
      const info = await fetchCfUserInfoWithRetry(link.cfHandle)
      cfRating = info.rating ?? null
      cfRawPayload = info
    } catch (err) {
      cfError = err instanceof CfApiError ? err.message : 'Unknown Codeforces error'
      logger.warn({ msg: 'CF sync failed for user', userId, handle: link.cfHandle, error: cfError })
    }
  }

  let lcSolvedTotal: number | null = null
  let lcSolvedLast30d: number | null = null
  let lcSolvedLast90d: number | null = null
  let lcError: string | null = null

  if (link.lcUsername) {
    try {
      const stats = await fetchLcStats(link.lcUsername)
      lcSolvedTotal = stats.solvedTotal
      lcSolvedLast30d = stats.solvedLast30d
      lcSolvedLast90d = stats.solvedLast90d
    } catch (err) {
      lcError = 'Unknown LeetCode error'
      logger.warn({ msg: 'LC sync failed for user', userId, username: link.lcUsername, error: lcError })
    }
  }

  const result = computeSyncScore({
    hasCfHandle: Boolean(link.cfHandle),
    hasLcHandle: Boolean(link.lcUsername),
    cfRating,
    lcSolvedLast30d,
    lcSolvedLast90d,
  })

  await prisma.ratingSnapshot.create({
    data: {
      userId,
      cfRating,
      lcSolvedTotal,
      lcSolvedLast30d,
      lcSolvedLast90d,
      syncScore: result.score,
      syncScoreVersion: result.version,
    },
  })

  // Denormalized for orderBy/skip/take on leaderboard queries
  await prisma.user.update({
    where: { id: userId },
    data: { currentSyncScore: result.score },
  })

  const combinedError =
    [cfError && `CF: ${cfError}`, lcError && `LC: ${lcError}`].filter(Boolean).join(' | ') || null

  await prisma.handleLink.update({
    where: { userId },
    data: {
      lastSyncedAt: new Date(),
      isStale: Boolean(cfError) && Boolean(lcError),
      lastError: combinedError,
    },
  })

  await prisma.syncJobLog.create({
    data: {
      userId,
      status: combinedError ? 'failed' : 'success',
      source: 'combined',
      attempt: job.attemptsMade + 1,
      errorMessage: combinedError,
      rawPayload: cfRawPayload ? (capPayload(cfRawPayload) as object) : undefined,
      finishedAt: new Date(),
    },
  })

  logger.info({ msg: 'sync job complete', userId, score: result.score, cfError, lcError })
}