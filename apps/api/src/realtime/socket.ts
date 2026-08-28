import type { FastifyInstance } from 'fastify'
import { Server as SocketIoServer, type Socket } from 'socket.io'
import Redis from 'ioredis'
import { verifyAuthToken, AUTH_COOKIE_NAME, type AuthTokenPayload } from '../lib/auth.js'
import { prisma } from '@syncrank/db'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { CONTEST_EVENTS_CHANNEL, type ContestEventMessage } from '@syncrank/shared'
import cookie from 'cookie'

type AuthedSocket = Socket & { data: { user: AuthTokenPayload } }

let io: SocketIoServer | null = null

export function getIo(): SocketIoServer {
  if (!io) throw new Error('Socket.IO not initialized — call registerRealtime(app) first')
  return io
}

export function contestRoom(contestId: string): string {
  return `contest:${contestId}`
}

/**
 * Broadcasts a standings update to everyone watching a contest. Called by
 * the API after a submission is recorded, and by the worker after a
 * scheduled recompute.
 */
export function broadcastStandings(contestId: string, standings: unknown): void {
  getIo()
    .to(contestRoom(contestId))
    .emit('standings:update', { contestId, standings, at: new Date().toISOString() })
}

export function registerRealtime(app: FastifyInstance): void {
  io = new SocketIoServer(app.server, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    path: '/socket.io',
  })

  // Auth handshake: read the same httpOnly session cookie the REST API uses,
  // so there's exactly one source of truth for "who is this".
  io.use(async (socket, next) => {
    try {
      const rawCookie = socket.handshake.headers.cookie
      if (!rawCookie) return next(new Error('unauthenticated'))

      const parsed = cookie.parse(rawCookie)
      const token = parsed[AUTH_COOKIE_NAME]
      if (!token) return next(new Error('unauthenticated'))

      const payload = verifyAuthToken(token)
      ;(socket as AuthedSocket).data.user = payload
      next()
    } catch (err) {
      next(new Error('unauthenticated'))
    }
  })

  io.on('connection', (socket) => {
    const authed = socket as AuthedSocket
    logger.info({ msg: 'socket connected', userId: authed.data.user?.sub })

    socket.on('contest:join', async (contestId: string, ack?: (ok: boolean, reason?: string) => void) => {
      try {
        const contest = await prisma.contest.findUnique({ where: { id: contestId } })
        if (!contest) return ack?.(false, 'contest not found')

        const user = authed.data.user
        // Campus-scoped contests require same-campus membership; public
        // contests are open to any authenticated user.
        if (contest.visibility === 'campus') {
          const dbUser = await prisma.user.findUnique({ where: { id: user.sub } })
          if (!dbUser || dbUser.campusId !== contest.campusId) {
            return ack?.(false, 'not authorized for this campus contest')
          }
        }

        await socket.join(contestRoom(contestId))
        ack?.(true)
      } catch (err) {
        logger.error({ msg: 'contest:join failed', err: (err as Error).message })
        ack?.(false, 'internal error')
      }
    })

    socket.on('contest:leave', (contestId: string) => {
      socket.leave(contestRoom(contestId))
    })

    socket.on('disconnect', () => {
      logger.info({ msg: 'socket disconnected', userId: authed.data.user?.sub })
    })
  })

  // Relay worker-originated events (contest status transitions) into the
  // matching Socket.IO room. Uses a dedicated Redis connection because
  // ioredis puts a client into subscriber mode, which blocks it from
  // running normal commands on that same connection.
  const subscriber = new Redis(env.REDIS_URL)
  subscriber.subscribe(CONTEST_EVENTS_CHANNEL).catch((err) => {
    logger.error({ msg: 'failed to subscribe to contest events channel', err: err.message })
  })
  subscriber.on('message', (_channel, raw) => {
    try {
      const message = JSON.parse(raw) as ContestEventMessage
      io?.to(contestRoom(message.contestId)).emit('contest:event', message)
    } catch (err) {
      logger.warn({ msg: 'failed to parse contest event message', err: (err as Error).message })
    }
  })
}
