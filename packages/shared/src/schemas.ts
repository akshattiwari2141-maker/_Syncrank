import { z } from 'zod'

export const Role = z.enum(['student', 'campus_admin'])
export type Role = z.infer<typeof Role>

export const ContestStatus = z.enum(['draft', 'scheduled', 'live', 'completed'])
export type ContestStatus = z.infer<typeof ContestStatus>

export const ContestVisibility = z.enum(['campus', 'public'])
export type ContestVisibility = z.infer<typeof ContestVisibility>

export const ScoringMode = z.enum(['acm', 'score'])
export type ScoringMode = z.infer<typeof ScoringMode>

// ---------- Auth ----------
export const RegisterInput = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  campusId: z.string().uuid(),
})
export type RegisterInput = z.infer<typeof RegisterInput>

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
})
export type LoginInput = z.infer<typeof LoginInput>

// ---------- Handles ----------
export const LinkHandlesInput = z.object({
  cfHandle: z.string().min(1).max(40).optional(),
  lcUsername: z.string().min(1).max(40).optional(),
})
export type LinkHandlesInput = z.infer<typeof LinkHandlesInput>

// ---------- Contests ----------
export const ContestProblemInput = z.object({
  code: z.string().min(1).max(30),
  title: z.string().min(1).max(160),
  difficulty: z.enum(['easy', 'med', 'hard']),
  points: z.number().int().min(0).max(5000),
  order: z.number().int().min(0),
})
export type ContestProblemInput = z.infer<typeof ContestProblemInput>

export const CreateContestInput = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  startAt: z.string().datetime(),
  durationMins: z.number().int().min(10).max(24 * 60),
  visibility: ContestVisibility,
  scoringMode: ScoringMode,
  participantsMode: z.enum(['all', 'invite']),
  problems: z.array(ContestProblemInput).min(1).max(20),
})
export type CreateContestInput = z.infer<typeof CreateContestInput>

export const UpdateContestInput = CreateContestInput.partial()
export type UpdateContestInput = z.infer<typeof UpdateContestInput>

export const SubmitInput = z.object({
  problemId: z.string().uuid(),
  verdict: z.enum(['accepted', 'wrong_answer', 'time_limit', 'runtime_error']),
})
export type SubmitInput = z.infer<typeof SubmitInput>

// ---------- Pagination ----------
export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type PaginationQuery = z.infer<typeof PaginationQuery>

export const LeaderboardQuery = PaginationQuery.extend({
  year: z.coerce.number().int().optional(),
  branch: z.string().max(20).optional(),
})
export type LeaderboardQuery = z.infer<typeof LeaderboardQuery>

// ---------- Error shape (consistent across API) ----------
export const ApiError = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
})
export type ApiError = z.infer<typeof ApiError>
