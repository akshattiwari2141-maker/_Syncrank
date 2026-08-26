import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import {
  RegisterInput,
  LoginInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
} from '@syncrank/shared'
import { prisma } from '@syncrank/db'
import {
  hashPassword,
  verifyPassword,
  signAuthToken,
  AUTH_COOKIE_NAME,
  authCookieOptions,
} from '../lib/auth.js'
import { logger } from '../lib/logger.js'
import { env } from '../lib/env.js'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = RegisterInput.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { email, password, name, campusId } = parsed.data

    const campus = await prisma.campus.findUnique({ where: { id: campusId } })
    if (!campus) {
      return reply.code(400).send({ error: 'Unknown campus', code: 'CAMPUS_NOT_FOUND' })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      // Deliberately generic message — don't confirm/deny account existence
      // to an unauthenticated caller.
      return reply.code(409).send({ error: 'Could not create account with these details', code: 'REGISTRATION_FAILED' })
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: { email, name, passwordHash, campusId, role: 'student' },
    })

    const token = signAuthToken({ sub: user.id, role: user.role, campusId: user.campusId })
    reply.setCookie(AUTH_COOKIE_NAME, token, authCookieOptions)

    return reply.code(201).send({ id: user.id, email: user.email, name: user.name, role: user.role })
  })

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = LoginInput.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was.
    const invalid = () => reply.code(401).send({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' })

    if (!user) return invalid()

    // Google-only accounts have no passwordHash
    if (!user.passwordHash) return invalid()

    const ok = await verifyPassword(user.passwordHash, password)
    if (!ok) return invalid()

    const token = signAuthToken({ sub: user.id, role: user.role, campusId: user.campusId })
    reply.setCookie(AUTH_COOKIE_NAME, token, authCookieOptions)

    return reply.send({ id: user.id, email: user.email, name: user.name, role: user.role })
  })

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' })
    return reply.send({ ok: true })
  })

  app.get('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      include: { campus: true, handleLink: true },
    })
    if (!user) return reply.code(404).send({ error: 'User not found', code: 'USER_NOT_FOUND' })

    return reply.send({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branch: user.branch,
      gradYear: user.gradYear,
      campus: { id: user.campus.id, name: user.campus.name },
      handles: user.handleLink
        ? {
            cfHandle: user.handleLink.cfHandle,
            lcUsername: user.handleLink.lcUsername,
            lastSyncedAt: user.handleLink.lastSyncedAt,
            isStale: user.handleLink.isStale,
            lastError: user.handleLink.lastError,
          }
        : null,
    })
  })

  app.post(
    '/auth/forgot-password',
    { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const parsed = RequestPasswordResetInput.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid input',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        })
      }

      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
      })

      // Always 200 — don't reveal whether the email exists
      let devToken: string | undefined
      if (user) {
        // Google-only users can't reset a password they never set
        if (!user.passwordHash) {
          return reply.send({
            ok: true,
            message: 'If that email exists, a reset link was sent.',
          })
        }

        const rawToken = crypto.randomBytes(32).toString('hex')
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        })
        // Email delivery stubbed — log token for local/demo testing only
        logger.info({
          msg: 'password reset token generated',
          email: user.email,
          rawToken,
        })
        // DEV ONLY — never expose token in production responses
        if (env.NODE_ENV !== 'production') {
          devToken = rawToken
        }
      }

      return reply.send({
        ok: true,
        message: 'If that email exists, a reset link was sent.',
        ...(devToken ? { devToken } : {}),
      })
    },
  )

  app.post(
    '/auth/reset-password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const parsed = ResetPasswordInput.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid input',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        })
      }

      const tokenHash = crypto
        .createHash('sha256')
        .update(parsed.data.token)
        .digest('hex')

      const record = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
      })

      if (!record || record.usedAt || record.expiresAt < new Date()) {
        return reply.code(400).send({
          error: 'Invalid or expired reset link',
          code: 'INVALID_TOKEN',
        })
      }

      const passwordHash = await hashPassword(parsed.data.newPassword)
      await prisma.$transaction([
        prisma.user.update({
          where: { id: record.userId },
          data: { passwordHash },
        }),
        prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
      ])

      return reply.send({ ok: true })
    },
  )
}