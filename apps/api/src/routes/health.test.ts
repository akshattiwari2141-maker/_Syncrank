import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { healthRoutes } from './health.js'

vi.mock('@syncrank/db', () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) },
}))
vi.mock('../lib/redis.js', () => ({
  redis: { ping: vi.fn().mockResolvedValue('PONG') },
}))

describe('health routes', () => {
  it('GET /health returns ok', async () => {
    const app = Fastify()
    await app.register(healthRoutes)
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('GET /ready returns ready when db and redis are up', async () => {
    const app = Fastify()
    await app.register(healthRoutes)
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ready')
  })
})