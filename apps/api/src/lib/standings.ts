import { prisma } from '@syncrank/db'
import { redis } from './redis.js'

export interface StandingsRow {
  userId: string
  userName: string
  solved: number
  penaltyMins: number
  score: number
  rank: number
}

const STANDINGS_TTL_SEC = 5

export async function invalidateStandingsCache(contestId: string): Promise<void> {
  try {
    await redis.del(`standings:${contestId}`)
  } catch {
    // Redis down — ignore
  }
}

/**
 * Server-authoritative standings. Cached in Redis for a few seconds.
 * ACM: (solved desc, penalty asc). Unsolved → no penalty.
 * Score: points with 10% dock per wrong attempt, floor 50%.
 */
export async function computeStandings(contestId: string): Promise<StandingsRow[]> {
  const cacheKey = `standings:${contestId}`

  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as StandingsRow[]
    }
  } catch {
    // fall through to DB
  }

  const contest = await prisma.contest.findUniqueOrThrow({
    where: { id: contestId },
    include: { registrations: { include: { user: true } }, problems: true },
  })

  const pointsByProblemId = new Map<string, number>(
    contest.problems.map((p: { id: string; points: number }) => [p.id, p.points]),
  )

  const submissions = await prisma.submission.findMany({
    where: { contestId },
    orderBy: { submittedAt: 'asc' },
  })
  type SubmissionRow = (typeof submissions)[number]

  const byUser = new Map<string, SubmissionRow[]>()
  for (const sub of submissions) {
    const list = byUser.get(sub.userId) ?? []
    list.push(sub)
    byUser.set(sub.userId, list)
  }

  type RegistrationRow = (typeof contest.registrations)[number]

  const rows: Omit<StandingsRow, 'rank'>[] = contest.registrations.map((reg: RegistrationRow) => {
    const subs = byUser.get(reg.userId) ?? []
    const byProblem = new Map<string, SubmissionRow[]>()
    for (const s of subs) {
      const list = byProblem.get(s.problemId) ?? []
      list.push(s)
      byProblem.set(s.problemId, list)
    }

    let solved = 0
    let penaltyMins = 0
    let score = 0

    for (const [problemId, problemSubs] of byProblem) {
      const acceptedIndex = problemSubs.findIndex((s: SubmissionRow) => s.verdict === 'accepted')
      if (acceptedIndex === -1) continue

      solved += 1
      const wrongBefore = acceptedIndex
      const acSub = problemSubs[acceptedIndex]

      if (contest.scoringMode === 'acm') {
        const minutesElapsed = contest.startAt
          ? Math.max(
              0,
              Math.round((acSub.submittedAt.getTime() - contest.startAt.getTime()) / 60000),
            )
          : 0
        penaltyMins += minutesElapsed + wrongBefore * 20
      } else {
        const problemPoints: number = pointsByProblemId.get(problemId) ?? 0
        const penaltyFactor = Math.max(0.5, 1 - wrongBefore * 0.1)
        score += Math.round(problemPoints * penaltyFactor)
      }
    }

    return {
      userId: reg.userId,
      userName: reg.user.name,
      solved,
      penaltyMins,
      score,
    }
  })

  const sorted =
    contest.scoringMode === 'acm'
      ? rows.sort((a, b) => b.solved - a.solved || a.penaltyMins - b.penaltyMins)
      : rows.sort((a, b) => b.score - a.score)

  const result = sorted.map((row, i) => ({ ...row, rank: i + 1 }))

  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', STANDINGS_TTL_SEC)
  } catch {
    // ignore
  }

  return result
}