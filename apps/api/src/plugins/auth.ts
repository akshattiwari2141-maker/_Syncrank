import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AUTH_COOKIE_NAME, verifyAuthToken, type AuthTokenPayload } from '../lib/auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthTokenPayload | null
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRole: (role: AuthTokenPayload['role']) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

/**
 * Reads the session cookie on every request and attaches the decoded user
 * (or null) to req.user. Route-level guards (requireAuth / requireRole)
 * are what actually enforce access — this plugin only decodes.
 */
export default fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null)

  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME]
    if (!token) {
      req.user = null
      return
    }
    try {
      req.user = verifyAuthToken(token)
    } catch {
      req.user = null
    }
  })

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'Authentication required', code: 'UNAUTHENTICATED' })
    }
  })

  app.decorate('requireRole', (role: AuthTokenPayload['role']) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) {
        return reply.code(401).send({ error: 'Authentication required', code: 'UNAUTHENTICATED' })
      }
      if (req.user.role !== role) {
        return reply.code(403).send({ error: 'Insufficient permissions', code: 'FORBIDDEN' })
      }
    }
  })
})
