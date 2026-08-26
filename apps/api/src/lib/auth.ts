import jwt from 'jsonwebtoken'
import argon2 from 'argon2'
import { env } from './env.js'

export interface AuthTokenPayload {
  sub: string // userId
  role: 'student' | 'campus_admin'
  campusId: string
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS })
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload
}

export const AUTH_COOKIE_NAME = 'syncrank_session'

export const authCookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: TOKEN_TTL_SECONDS,
}

export async function hashPassword(plain: string): Promise<string> {
  // argon2id — the OWASP-recommended variant, resistant to both GPU and
  // side-channel attacks. Default cost params are already tuned sensibly.
  return argon2.hash(plain, { type: argon2.argon2id })
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain)
  } catch {
    // Malformed hash (e.g. corrupted data) should fail closed, not throw.
    return false
  }
}
