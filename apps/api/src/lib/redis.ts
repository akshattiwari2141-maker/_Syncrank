import Redis from 'ioredis'
import { env } from './env.js'

// Two connections: one for general use (rate limiting, cache reads), one
// dedicated to BullMQ which wants its own connection with specific options.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})

redis.on('error', (err) => {
  console.error({ msg: 'redis connection error', err: err.message })
})
