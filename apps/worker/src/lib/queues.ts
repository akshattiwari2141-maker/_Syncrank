import { Queue, Worker, type Job } from 'bullmq'
import { redis } from './redis.js'
import {
  SYNC_QUEUE_NAME,
  CONTEST_LIFECYCLE_QUEUE_NAME,
  type SyncUserJobData,
  type SyncQueueJobData,
  type ContestLifecycleJobData,
} from '@syncrank/shared'

export const syncQueue = new Queue<SyncQueueJobData>(SYNC_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
})

export const contestLifecycleQueue = new Queue<ContestLifecycleJobData>(CONTEST_LIFECYCLE_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: { age: 60 * 60 * 24 },
  },
})

export async function enqueueUserSync(userId: string): Promise<void> {
  await syncQueue.add('sync', { userId }, { jobId: `sync-${userId}-${Date.now()}` })
}

export async function enqueueContestTransition(data: ContestLifecycleJobData): Promise<void> {
  // Dedupe by contestId+transition so a slow poll cycle doesn't queue the
  // same transition twice before the first one has run.
  await contestLifecycleQueue.add('transition', data, { jobId: `${data.contestId}-${data.transition}` })
}

export function createSyncWorker(processor: (job: Job<SyncQueueJobData>) => Promise<void>): Worker<SyncQueueJobData> {
  return new Worker<SyncQueueJobData>(SYNC_QUEUE_NAME, processor, {
    connection: redis,
    concurrency: 5, // bounded — we're rate-limited by CF's ~1req/sec anyway
  })
}

export function createLifecycleWorker(
  processor: (job: Job<ContestLifecycleJobData>) => Promise<void>,
): Worker<ContestLifecycleJobData> {
  return new Worker<ContestLifecycleJobData>(CONTEST_LIFECYCLE_QUEUE_NAME, processor, {
    connection: redis,
    concurrency: 3,
  })
}
