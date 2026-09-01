import { redis } from './redis.js'
import { CONTEST_EVENTS_CHANNEL, type ContestEventMessage } from '@syncrank/shared'

export { CONTEST_EVENTS_CHANNEL }

export async function broadcastToRedis(contestId: string, event: Omit<ContestEventMessage, 'contestId'>): Promise<void> {
  const message: ContestEventMessage = { contestId, ...event }
  await redis.publish(CONTEST_EVENTS_CHANNEL, JSON.stringify(message))
}
