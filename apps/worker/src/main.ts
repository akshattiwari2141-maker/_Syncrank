import type { Job } from 'bullmq'
import { env } from './lib/env.js'
import { logger } from './lib/logger.js'
import { syncQueue, contestLifecycleQueue, createSyncWorker, createLifecycleWorker, enqueueContestTransition } from './lib/queues.js'
import { processSyncJob } from './processors/sync-job.js'
import { processNightlyScan } from './processors/nightly-scan.js'
import { processContestLifecycleJob, scanAndEnqueueTransitions } from './processors/contest-lifecycle.js'
import type { SyncQueueJobData, ContestLifecycleJobData } from '@syncrank/shared'

async function main() {
  logger.info({ msg: 'SyncRank worker starting', env: env.NODE_ENV, fixtureMode: env.FIXTURE_MODE })

  // ---- Sync worker: handles both per-user syncs and the nightly scan job,
  // distinguished by job name (same queue, same rate-limit-aware code path). ----
  const syncWorker = createSyncWorker(async (job: Job<SyncQueueJobData>) => {
    if (job.name === 'nightly-scan') {
      await processNightlyScan()
      return
    }
    await processSyncJob(job as Job<Extract<SyncQueueJobData, { userId: string }>>)
  })

  syncWorker.on('failed', (job, err) => {
    logger.error({ msg: 'sync job failed permanently', jobId: job?.id, jobName: job?.name, error: err.message })
  })

  // ---- Contest lifecycle worker ----
  const lifecycleWorker = createLifecycleWorker(async (job: Job<ContestLifecycleJobData>) => {
    await processContestLifecycleJob(job)
  })

  lifecycleWorker.on('failed', (job, err) => {
    logger.error({ msg: 'lifecycle job failed permanently', jobId: job?.id, contestId: job?.data.contestId, error: err.message })
  })

  // ---- Nightly sync: a BullMQ repeatable job at 2am server time.
  // jobId ensures re-running main() (e.g. on redeploy) doesn't stack
  // duplicate repeatable schedules. ----
  await syncQueue.add('nightly-scan', { scan: true }, { repeat: { pattern: '0 2 * * *' }, jobId: 'nightly-sync-scan' })

  // ---- Contest lifecycle scheduler: polls for scheduled->live and
  // live->completed transitions on an interval. Simpler and more resilient
  // to worker restarts than trying to schedule exact delayed jobs per
  // contest at creation time. ----
  const pollLifecycle = async () => {
    try {
      await scanAndEnqueueTransitions((data) => enqueueContestTransition(data))
    } catch (err) {
      logger.error({ msg: 'contest lifecycle poll failed', err: (err as Error).message })
    }
  }
  await pollLifecycle()
  const intervalHandle = setInterval(pollLifecycle, env.CONTEST_LIFECYCLE_POLL_MS)

  logger.info({ msg: 'SyncRank worker ready', pollIntervalMs: env.CONTEST_LIFECYCLE_POLL_MS })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      logger.info({ msg: `${signal} received, shutting down worker gracefully` })
      clearInterval(intervalHandle)
      await Promise.all([syncWorker.close(), lifecycleWorker.close(), syncQueue.close(), contestLifecycleQueue.close()])
      process.exit(0)
    })
  }
}

main().catch((err) => {
  logger.error({ msg: 'worker failed to start', err: err.message })
  process.exit(1)
})
