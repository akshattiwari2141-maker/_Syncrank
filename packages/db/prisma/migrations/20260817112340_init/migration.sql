-- CreateEnum
CREATE TYPE "Role" AS ENUM ('student', 'campus_admin');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('draft', 'scheduled', 'live', 'completed');

-- CreateEnum
CREATE TYPE "ContestVisibility" AS ENUM ('campus', 'public');

-- CreateEnum
CREATE TYPE "ScoringMode" AS ENUM ('acm', 'score');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('easy', 'med', 'hard');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('accepted', 'wrong_answer', 'time_limit', 'runtime_error');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('queued', 'running', 'success', 'failed');

-- CreateTable
CREATE TABLE "campuses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'student',
    "branch" TEXT,
    "gradYear" INTEGER,
    "campusId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handle_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cfHandle" TEXT,
    "lcUsername" TEXT,
    "lastSyncedAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "isStale" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "handle_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cfRating" INTEGER,
    "lcSolvedTotal" INTEGER,
    "lcSolvedLast30d" INTEGER,
    "lcSolvedLast90d" INTEGER,
    "syncScore" INTEGER NOT NULL,
    "syncScoreVersion" INTEGER NOT NULL,
    "campusRank" INTEGER,
    "globalRank" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMPTZ(6),
    "durationMins" INTEGER NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'draft',
    "visibility" "ContestVisibility" NOT NULL DEFAULT 'campus',
    "scoringMode" "ScoringMode" NOT NULL DEFAULT 'acm',
    "participantsMode" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_problems" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "points" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "contest_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_registrations" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "penaltyMins" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_job_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT,
    "rawPayload" JSONB,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sync_job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campuses_name_key" ON "campuses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_campusId_idx" ON "users"("campusId");

-- CreateIndex
CREATE INDEX "users_campusId_role_idx" ON "users"("campusId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "handle_links_userId_key" ON "handle_links"("userId");

-- CreateIndex
CREATE INDEX "handle_links_lastSyncedAt_idx" ON "handle_links"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "rating_snapshots_userId_createdAt_idx" ON "rating_snapshots"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "rating_snapshots_syncScore_idx" ON "rating_snapshots"("syncScore");

-- CreateIndex
CREATE INDEX "contests_campusId_status_idx" ON "contests"("campusId", "status");

-- CreateIndex
CREATE INDEX "contests_status_startAt_idx" ON "contests"("status", "startAt");

-- CreateIndex
CREATE INDEX "contest_problems_contestId_order_idx" ON "contest_problems"("contestId", "order");

-- CreateIndex
CREATE INDEX "contest_registrations_contestId_idx" ON "contest_registrations"("contestId");

-- CreateIndex
CREATE UNIQUE INDEX "contest_registrations_contestId_userId_key" ON "contest_registrations"("contestId", "userId");

-- CreateIndex
CREATE INDEX "submissions_contestId_userId_idx" ON "submissions"("contestId", "userId");

-- CreateIndex
CREATE INDEX "submissions_contestId_submittedAt_idx" ON "submissions"("contestId", "submittedAt");

-- CreateIndex
CREATE INDEX "sync_job_logs_userId_startedAt_idx" ON "sync_job_logs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "sync_job_logs_status_idx" ON "sync_job_logs"("status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handle_links" ADD CONSTRAINT "handle_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_snapshots" ADD CONSTRAINT "rating_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contests" ADD CONSTRAINT "contests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_registrations" ADD CONSTRAINT "contest_registrations_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_registrations" ADD CONSTRAINT "contest_registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "contest_problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_job_logs" ADD CONSTRAINT "sync_job_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
