import type { FastifyInstance } from 'fastify'
import { CreateContestInput, UpdateContestInput, SubmitInput } from '@syncrank/shared'
import { prisma } from '@syncrank/db'
import { computeStandings, invalidateStandingsCache } from '../lib/standings.js'
import { broadcastStandings } from '../realtime/socket.js'

export async function contestRoutes(app: FastifyInstance) {
  app.get('/contests', { preHandler: app.requireAuth }, async (req, reply) => {
    const contests = await prisma.contest.findMany({
      where: { OR: [{ campusId: req.user!.campusId }, { visibility: 'public' }] },
      orderBy: [{ status: 'asc' }, { startAt: 'asc' }],
      include: { problems: true, _count: { select: { registrations: true } } },
    })
    return reply.send({ contests })
  })

  app.post('/contests', { preHandler: app.requireRole('campus_admin') }, async (req, reply) => {
    const parsed = CreateContestInput.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      })
    }
    const input = parsed.data

    const contest = await prisma.contest.create({
      data: {
        campusId: req.user!.campusId,
        createdById: req.user!.sub,
        title: input.title,
        description: input.description,
        startAt: new Date(input.startAt),
        durationMins: input.durationMins,
        visibility: input.visibility,
        scoringMode: input.scoringMode,
        participantsMode: input.participantsMode,
        status: 'draft',
        problems: {
          create: input.problems.map((p) => ({
            code: p.code,
            title: p.title,
            difficulty: p.difficulty,
            points: p.points,
            order: p.order,
          })),
        },
      },
      include: { problems: true },
    })

    return reply.code(201).send({ contest })
  })

  app.get('/contests/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const contest = await prisma.contest.findUnique({
      where: { id },
      include: {
        problems: { orderBy: { order: 'asc' } },
        _count: { select: { registrations: true } },
      },
    })
    if (!contest) return reply.code(404).send({ error: 'Contest not found', code: 'NOT_FOUND' })
    if (contest.visibility === 'campus' && contest.campusId !== req.user!.campusId) {
      return reply.code(403).send({ error: 'Not authorized for this contest', code: 'FORBIDDEN' })
    }
    return reply.send({ contest })
  })

  app.patch('/contests/:id', { preHandler: app.requireRole('campus_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = UpdateContestInput.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      })
    }

    const existing = await prisma.contest.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'Contest not found', code: 'NOT_FOUND' })
    if (existing.createdById !== req.user!.sub) {
      return reply.code(403).send({ error: 'Only the creator can edit this contest', code: 'FORBIDDEN' })
    }
    if (existing.status !== 'draft') {
      return reply.code(409).send({ error: 'Only draft contests can be edited', code: 'NOT_EDITABLE' })
    }

    const { problems, startAt, ...rest } = parsed.data

    const contest = await prisma.contest.update({
      where: { id },
      data: {
        ...rest,
        ...(startAt ? { startAt: new Date(startAt) } : {}),
        ...(problems
          ? {
              problems: {
                deleteMany: {},
                create: problems.map((p) => ({
                  code: p.code,
                  title: p.title,
                  difficulty: p.difficulty,
                  points: p.points,
                  order: p.order,
                })),
              },
            }
          : {}),
      },
      include: { problems: true },
    })

    return reply.send({ contest })
  })

  app.post('/contests/:id/publish', { preHandler: app.requireRole('campus_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = await prisma.contest.findUnique({
      where: { id },
      include: { problems: true },
    })
    if (!existing) return reply.code(404).send({ error: 'Contest not found', code: 'NOT_FOUND' })
    if (existing.createdById !== req.user!.sub) {
      return reply.code(403).send({ error: 'Only the creator can publish this contest', code: 'FORBIDDEN' })
    }
    if (existing.problems.length === 0) {
      return reply.code(400).send({
        error: 'Add at least one problem before publishing',
        code: 'NO_PROBLEMS',
      })
    }
    if (!existing.startAt) {
      return reply.code(400).send({
        error: 'Set a start time before publishing',
        code: 'NO_START_TIME',
      })
    }

    const status = existing.startAt.getTime() <= Date.now() ? 'live' : 'scheduled'
    const contest = await prisma.contest.update({ where: { id }, data: { status } })
    return reply.send({ contest })
  })

  app.post('/contests/:id/register', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const contest = await prisma.contest.findUnique({ where: { id } })
    if (!contest) return reply.code(404).send({ error: 'Contest not found', code: 'NOT_FOUND' })
    if (contest.status === 'completed') {
      return reply.code(409).send({
        error: 'This contest has already ended',
        code: 'CONTEST_ENDED',
      })
    }
    if (contest.visibility === 'campus' && contest.campusId !== req.user!.campusId) {
      return reply.code(403).send({ error: 'Not authorized for this contest', code: 'FORBIDDEN' })
    }

    const registration = await prisma.contestRegistration.upsert({
      where: { contestId_userId: { contestId: id, userId: req.user!.sub } },
      update: {},
      create: { contestId: id, userId: req.user!.sub },
    })

    return reply.code(201).send({ registration })
  })

  app.post(
    '/contests/:id/submit',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const parsed = SubmitInput.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid input',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        })
      }
      const { problemId, verdict } = parsed.data

      const contest = await prisma.contest.findUnique({ where: { id } })
      if (!contest) {
        return reply.code(404).send({ error: 'Contest not found', code: 'NOT_FOUND' })
      }
      if (contest.status !== 'live') {
        return reply.code(409).send({
          error: 'Contest is not currently live',
          code: 'CONTEST_NOT_LIVE',
        })
      }

      // Validate that the problem belongs to this contest
      const problem = await prisma.contestProblem.findUnique({ where: { id: problemId } })
      if (!problem || problem.contestId !== id) {
        return reply.code(400).send({
          error: 'This problem does not belong to this contest',
          code: 'PROBLEM_NOT_IN_CONTEST',
        })
      }

      const registered = await prisma.contestRegistration.findUnique({
        where: { contestId_userId: { contestId: id, userId: req.user!.sub } },
      })
      if (!registered) {
        return reply.code(403).send({
          error: 'Register for this contest before submitting',
          code: 'NOT_REGISTERED',
        })
      }

      const idempotencyKey =
        (req.headers['idempotency-key'] as string | undefined)?.trim() || undefined

      if (idempotencyKey) {
        const existing = await prisma.submission.findUnique({
          where: { idempotencyKey },
        })
        if (existing) {
          const standings = await computeStandings(id)
          return reply.send({ submission: existing, standings, idempotent: true })
        }
      }

      let submission
      try {
        submission = await prisma.$transaction(async (tx) => {
          return tx.submission.create({
            data: {
              contestId: id,
              problemId,
              userId: req.user!.sub,
              verdict,
              ...(idempotencyKey ? { idempotencyKey } : {}),
            },
          })
        })
      } catch (err: unknown) {
        const code =
          typeof err === 'object' && err && 'code' in err
            ? (err as { code?: string }).code
            : undefined
        if (idempotencyKey && code === 'P2002') {
          const existing = await prisma.submission.findUnique({
            where: { idempotencyKey },
          })
          if (existing) {
            const standings = await computeStandings(id)
            return reply.send({ submission: existing, standings, idempotent: true })
          }
        }
        throw err
      }

      await invalidateStandingsCache(id)

      const standings = await computeStandings(id)
      broadcastStandings(id, standings)

      return reply.code(201).send({ submission, standings })
    },
  )

  app.get('/contests/:id/standings', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const contest = await prisma.contest.findUnique({ where: { id } })
    if (!contest) {
      return reply.code(404).send({ error: 'Contest not found', code: 'NOT_FOUND' })
    }

    const standings = await computeStandings(id)
    return reply.send({ standings })
  })
}