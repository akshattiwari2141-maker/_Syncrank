export const SYNC_QUEUE_NAME = 'sync-user'
export const CONTEST_LIFECYCLE_QUEUE_NAME = 'contest-lifecycle'
export const CONTEST_EVENTS_CHANNEL = 'syncrank:contest-events'

export interface SyncUserJobData {
  userId: string
}

/** Payload for the nightly repeatable job that fans out per-user sync jobs. */
export interface NightlyScanJobData {
  scan: true
}

export type SyncQueueJobData = SyncUserJobData | NightlyScanJobData

export interface ContestLifecycleJobData {
  contestId: string
  transition: 'start' | 'complete'
}

export interface ContestEventMessage {
  contestId: string
  type: 'status' | 'standings'
  status?: 'live' | 'completed'
}
