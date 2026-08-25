import pino from 'pino'
import { env } from './env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  // Pretty-print locally for readability; ship raw JSON in production so
  // log aggregators (Datadog, CloudWatch, etc.) can parse it directly.
  transport:
    env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', 'passwordHash'],
})
