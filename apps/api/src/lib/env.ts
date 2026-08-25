import { z } from 'zod'

// Fail fast and loud if required env vars are missing — better than a
// half-configured server silently misbehaving in production.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  FIXTURE_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  CF_API_BASE_URL: z.string().url().default('https://codeforces.com/api'),
  CF_REQUEST_DELAY_MS: z.coerce.number().int().default(2000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:')
  console.error(parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment configuration — see errors above. Check .env against .env.example.')
}

export const env = parsed.data
