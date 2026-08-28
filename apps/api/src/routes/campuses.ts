import type { FastifyInstance } from 'fastify'
import { prisma } from '@syncrank/db'

export async function campusRoutes(app: FastifyInstance) {
  // Deliberately public (no requireAuth) — a new user needs to pick their
  // campus before they have an account to authenticate with.
  app.get('/campuses', async (_req, reply) => {
    const campuses = await prisma.campus.findMany({
      select: { id: true, name: true, city: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ campuses })
  })
}
