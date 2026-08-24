import { describe, it, expect } from 'vitest'
import { computeSyncScore, computeLcVelocity, SYNC_SCORE_VERSION } from './sync-score.js'

describe('computeLcVelocity', () => {
  it('weights last-30d solves more heavily than last-90d', () => {
    const v = computeLcVelocity(10, 20)
    expect(v).toBe(10 * 1.5 + 20 * 0.5) // 25
  })

  it('handles null/undefined as zero', () => {
    expect(computeLcVelocity(null, undefined)).toBe(0)
  })

  it('never goes negative even with bad input', () => {
    expect(computeLcVelocity(-5, -10)).toBe(0)
  })
})

describe('computeSyncScore', () => {
  it('returns 0 with version stamped when neither handle is linked', () => {
    const r = computeSyncScore({ hasCfHandle: false, hasLcHandle: false })
    expect(r.score).toBe(0)
    expect(r.version).toBe(SYNC_SCORE_VERSION)
    expect(r.weightsUsed).toEqual({ wCf: 0, wLc: 0 })
  })

  it('gives full weight to CF when only CF is linked', () => {
    const r = computeSyncScore({ hasCfHandle: true, hasLcHandle: false, cfRating: 1500 })
    expect(r.weightsUsed).toEqual({ wCf: 1, wLc: 0 })
    expect(r.lcComponent).toBe(0)
    expect(r.score).toBeGreaterThan(0)
  })

  it('gives full weight to LC when only LC is linked', () => {
    const r = computeSyncScore({ hasCfHandle: false, hasLcHandle: true, lcSolvedLast30d: 20, lcSolvedLast90d: 40 })
    expect(r.weightsUsed).toEqual({ wCf: 0, wLc: 1 })
    expect(r.cfComponent).toBe(0)
    expect(r.score).toBeGreaterThan(0)
  })

  it('treats a linked-but-unrated CF account as the floor, not an error', () => {
    const r = computeSyncScore({ hasCfHandle: true, hasLcHandle: false, cfRating: null })
    expect(r.cfComponent).toBe(0)
    expect(r.score).toBe(0)
  })

  it('blends both components with default weights when both are linked', () => {
    const r = computeSyncScore({
      hasCfHandle: true,
      hasLcHandle: true,
      cfRating: 3000, // max
      lcSolvedLast30d: 30, // -> velocity 45 = max
      lcSolvedLast90d: 0,
    })
    // Both components maxed at 1.0 -> score should be ~1000 (full scale)
    expect(r.cfComponent).toBeCloseTo(1, 5)
    expect(r.lcComponent).toBeCloseTo(1, 5)
    expect(r.score).toBe(1000)
  })

  it('clamps CF ratings above the normalization ceiling instead of overflowing', () => {
    const r = computeSyncScore({ hasCfHandle: true, hasLcHandle: false, cfRating: 5000 })
    expect(r.cfComponent).toBe(1)
    expect(r.score).toBe(1000)
  })

  it('is deterministic for the same input', () => {
    const input = { hasCfHandle: true, hasLcHandle: true, cfRating: 1732, lcSolvedLast30d: 12, lcSolvedLast90d: 40 }
    const a = computeSyncScore(input)
    const b = computeSyncScore(input)
    expect(a).toEqual(b)
  })

  it('never returns NaN for zero-value real accounts', () => {
    const r = computeSyncScore({ hasCfHandle: true, hasLcHandle: true, cfRating: 0, lcSolvedLast30d: 0, lcSolvedLast90d: 0 })
    expect(Number.isNaN(r.score)).toBe(false)
    expect(r.score).toBe(0)
  })
})
