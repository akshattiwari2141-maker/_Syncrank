import { Queue } from 'bullmq'
import { redis } from './redis.js'
import { SYNC_QUEUE_NAME, CONTEST_LIFECYCLE_QUEUE_NAME, type SyncUserJobData, type ContestLifecycleJobData } from '@syncrank/shared'

// The API only ever produces jobs — the worker is the sole consumer. Kept
// as a separate Queue instance (rather than importing the worker's) so the
// two processes have zero runtime coupling beyond Redis + the shared
// package defining the contract between them.
export const syncQueue = new Queue<SyncUserJobData>(SYNC_QUEUE_NAME, {
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
  // jobId dedupes — if a sync for this user is already queued, don't stack
  // another one on top of it.
  await syncQueue.add('sync', { userId }, { jobId: `sync-${userId}` })
}
