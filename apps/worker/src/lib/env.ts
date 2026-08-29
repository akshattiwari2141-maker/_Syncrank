import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  FIXTURE_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  CF_API_BASE_URL: z.string().url().default('https://codeforces.com/api'),
  CF_REQUEST_DELAY_MS: z.coerce.number().int().default(2000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Worker also needs to know the API's Socket.IO origin to publish
  // standings updates via Redis pub/sub -> the API relays to sockets.
  CONTEST_LIFECYCLE_POLL_MS: z.coerce.number().int().default(30_000),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid worker environment configuration:')
  console.error(parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment configuration — check .env against .env.example.')
}

export const env = parsed.data
