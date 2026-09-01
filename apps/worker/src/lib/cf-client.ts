import { env } from './env.js'
import { logger } from './logger.js'

export interface CfUserInfo {
  handle: string
  rating?: number
  maxRating?: number
  rank?: string
}

export class CfApiError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'CfApiError'
  }
}

// Codeforces asks API consumers to keep requests under ~1/sec per source.
// We track the last call time process-wide and always wait at least
// CF_REQUEST_DELAY_MS between calls, regardless of which job triggered it.
let lastRequestAt = 0

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt
  const wait = env.CF_REQUEST_DELAY_MS - elapsed
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  lastRequestAt = Date.now()
}

async function cfFetch<T>(path: string): Promise<T> {
  await throttle()

  const res = await fetch(`${env.CF_API_BASE_URL}${path}`)

  if (res.status === 429) {
    throw new CfApiError('Codeforces rate limit hit', true)
  }
  if (!res.ok) {
    throw new CfApiError(`Codeforces API returned ${res.status}`, res.status >= 500)
  }

  const body = (await res.json()) as { status: 'OK' | 'FAILED'; comment?: string; result?: T }

  if (body.status !== 'OK') {
    // "handle not found" is a real, non-retryable outcome (user typo'd
    // their handle) — don't waste retries on it.
    const retryable = !/not found/i.test(body.comment ?? '')
    throw new CfApiError(body.comment ?? 'Codeforces API returned FAILED', retryable)
  }

  return body.result as T
}

export async function fetchCfUserInfo(handle: string): Promise<CfUserInfo> {
  const result = await cfFetch<CfUserInfo[]>(`/user.info?handles=${encodeURIComponent(handle)}`)
  const user = result[0]
  if (!user) throw new CfApiError(`No Codeforces user found for handle "${handle}"`, false)
  return user
}

/**
 * Fetch with retry + exponential backoff. Non-retryable errors
 * (bad handle, 4xx that isn't a rate limit) fail immediately.
 */
export async function fetchCfUserInfoWithRetry(handle: string, maxAttempts = 4): Promise<CfUserInfo> {
  let attempt = 0
  let lastError: unknown

  while (attempt < maxAttempts) {
    attempt += 1
    try {
      return await fetchCfUserInfo(handle)
    } catch (err) {
      lastError = err
      const retryable = err instanceof CfApiError ? err.retryable : true
      if (!retryable || attempt >= maxAttempts) break

      const backoffMs = Math.min(30_000, 500 * 2 ** attempt)
      logger.warn({ msg: 'CF fetch failed, retrying', handle, attempt, backoffMs, error: (err as Error).message })
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  throw lastError
}
