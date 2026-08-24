/**
 * Sync Score — versioned, pure, documented.
 *
 * v1 formula (SYNC_SCORE_VERSION = 1):
 *   cfComponent  = normalize(cfRating, CF_MIN, CF_MAX)        -> 0..1
 *   lcComponent  = normalize(lcSolveVelocity, LC_MIN, LC_MAX) -> 0..1
 *   syncScore    = round(1000 * (W_CF * cfComponent + W_LC * lcComponent))
 *
 * lcSolveVelocity = weighted recent solves, not raw lifetime total:
 *   velocity = solvedLast30d * 1.5 + solvedLast90d * 0.5
 * This rewards people who are *currently* active over someone who solved
 * 600 problems two years ago and stopped.
 *
 * Edge cases handled explicitly (see tests):
 *  - No CF handle linked: cfComponent = 0, weight redistributed to LC only
 *  - No LC handle linked: lcComponent = 0, weight redistributed to CF only
 *  - Neither linked: score = 0
 *  - Brand new CF account (rating undefined/unrated): treated as CF_MIN
 *  - Values outside expected range are clamped, never throw
 */

export const SYNC_SCORE_VERSION = 1 as const

export const SYNC_SCORE_WEIGHTS = {
  W_CF: 0.6,
  W_LC: 0.4,
} as const

// Normalization bounds — CF ratings realistically span ~0 (unrated) to ~3500
// (top of the world). LC velocity bounds are tuned from observed activity:
// 0 = inactive, 45 = very active (roughly 1.5/day for 30 days).
const CF_MIN = 0
const CF_MAX = 3000
const LC_VELOCITY_MIN = 0
const LC_VELOCITY_MAX = 45

export interface SyncScoreInput {
  /** Codeforces rating, or null/undefined if no handle linked or unrated. */
  cfRating?: number | null
  /** Problems solved on LeetCode in the last 30 days. */
  lcSolvedLast30d?: number | null
  /** Problems solved on LeetCode in the last 90 days (includes last30d). */
  lcSolvedLast90d?: number | null
  /** Whether a CF handle is linked at all (distinct from "linked but unrated"). */
  hasCfHandle: boolean
  /** Whether an LC handle is linked at all. */
  hasLcHandle: boolean
}

export interface SyncScoreResult {
  score: number
  version: typeof SYNC_SCORE_VERSION
  cfComponent: number
  lcComponent: number
  /** Effective weights actually used after redistribution for missing handles. */
  weightsUsed: { wCf: number; wLc: number }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return clamp((value - min) / (max - min), 0, 1)
}

export function computeLcVelocity(solvedLast30d?: number | null, solvedLast90d?: number | null): number {
  const d30 = Math.max(0, solvedLast30d ?? 0)
  const d90 = Math.max(0, solvedLast90d ?? 0)
  return d30 * 1.5 + d90 * 0.5
}

export function computeSyncScore(input: SyncScoreInput): SyncScoreResult {
  const { hasCfHandle, hasLcHandle } = input

  // Neither platform linked — score is unambiguously zero, not an error.
  if (!hasCfHandle && !hasLcHandle) {
    return {
      score: 0,
      version: SYNC_SCORE_VERSION,
      cfComponent: 0,
      lcComponent: 0,
      weightsUsed: { wCf: 0, wLc: 0 },
    }
  }

  const cfRating = hasCfHandle ? input.cfRating ?? CF_MIN : null
  const lcVelocity = hasLcHandle ? computeLcVelocity(input.lcSolvedLast30d, input.lcSolvedLast90d) : null

  const cfComponent = cfRating != null ? normalize(cfRating, CF_MIN, CF_MAX) : 0
  const lcComponent = lcVelocity != null ? normalize(lcVelocity, LC_VELOCITY_MIN, LC_VELOCITY_MAX) : 0

  // Redistribute weight to whichever platform is actually linked so a
  // single-platform student isn't structurally capped below multi-platform
  // students — they're just measured on what they have.
  let wCf: number = SYNC_SCORE_WEIGHTS.W_CF
  let wLc: number = SYNC_SCORE_WEIGHTS.W_LC
  if (hasCfHandle && !hasLcHandle) {
    wCf = 1
    wLc = 0
  } else if (hasLcHandle && !hasCfHandle) {
    wCf = 0
    wLc = 1
  }

  const raw = wCf * cfComponent + wLc * lcComponent
  const score = Math.round(1000 * raw)

  return {
    score,
    version: SYNC_SCORE_VERSION,
    cfComponent,
    lcComponent,
    weightsUsed: { wCf, wLc },
  }
}
