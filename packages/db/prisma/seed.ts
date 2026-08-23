import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import { computeSyncScore } from '@syncrank/shared'

const prisma = new PrismaClient()

// Deliberately uneven — real students don't form a clean bell curve.
const STUDENTS = [
  { name: 'Aditi Rao', email: 'aditi@srm.demo', branch: 'CSE', gradYear: 2027, cfRating: 1842, lc30: 18, lc90: 52 },
  { name: 'Riya Kulkarni', email: 'riya@srm.demo', branch: 'CSE', gradYear: 2026, cfRating: 1732, lc30: 14, lc90: 44 },
  { name: 'Karan Mehta', email: 'karan@srm.demo', branch: 'ECE', gradYear: 2026, cfRating: 1795, lc30: 9, lc90: 30 },
  { name: 'Sana Iqbal', email: 'sana@srm.demo', branch: 'CSE', gradYear: 2027, cfRating: 1710, lc30: 11, lc90: 38 },
  { name: 'Rohit Verma', email: 'rohit@srm.demo', branch: 'IT', gradYear: 2028, cfRating: 1663, lc30: 6, lc90: 22 },
  { name: 'Priya Nair', email: 'priya@srm.demo', branch: 'CSE', gradYear: 2026, cfRating: 1601, lc30: 4, lc90: 19 },
  { name: 'Devansh Rathi', email: 'devansh@srm.demo', branch: 'ECE', gradYear: 2028, cfRating: 1488, lc30: 2, lc90: 9 },
  { name: 'Meera Thomas', email: 'meera@srm.demo', branch: 'CSE', gradYear: 2028, cfRating: 1290, lc30: 0, lc90: 3 },
  { name: 'Farhan Ali', email: 'farhan@srm.demo', branch: 'IT', gradYear: 2027, cfRating: 1340, lc30: 1, lc90: 6 },
  { name: 'Neha Joshi', email: 'neha@srm.demo', branch: 'CSE', gradYear: 2027, cfRating: null, lc30: 8, lc90: 26 },
]

async function main() {
  console.log('Seeding SRM Institute...')

  const campus = await prisma.campus.upsert({
    where: { name: 'SRM Institute' },
    update: {},
    create: { name: 'SRM Institute', city: 'Chennai' },
  })

  const adminPasswordHash = await argon2.hash('AdminPass123!')
  const admin = await prisma.user.upsert({
    where: { email: 'admin@srm.demo' },
    update: {},
    create: {
      email: 'admin@srm.demo',
      passwordHash: adminPasswordHash,
      name: 'Campus Admin',
      role: 'campus_admin',
      campusId: campus.id,
    },
  })

  const studentPasswordHash = await argon2.hash('StudentPass123!')

  for (const s of STUDENTS) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        email: s.email,
        passwordHash: studentPasswordHash,
        name: s.name,
        role: 'student',
        branch: s.branch,
        gradYear: s.gradYear,
        campusId: campus.id,
      },
    })

    await prisma.handleLink.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        cfHandle: s.cfRating != null ? s.name.toLowerCase().replace(/\s+/g, '_') : null,
        lcUsername: s.name.toLowerCase().replace(/\s+/g, ''),
        lastSyncedAt: new Date(),
        isStale: false,
      },
    })

    const result = computeSyncScore({
      hasCfHandle: s.cfRating != null,
      hasLcHandle: true,
      cfRating: s.cfRating,
      lcSolvedLast30d: s.lc30,
      lcSolvedLast90d: s.lc90,
    })

    await prisma.ratingSnapshot.create({
      data: {
        userId: user.id,
        cfRating: s.cfRating,
        lcSolvedTotal: s.lc90 + 200, // pretend they had a history before this window
        lcSolvedLast30d: s.lc30,
        lcSolvedLast90d: s.lc90,
        syncScore: result.score,
        syncScoreVersion: result.version,
      },
    })
  }

  // A few contests at different lifecycle stages.
  const draft = await prisma.contest.create({
    data: {
      campusId: campus.id,
      createdById: admin.id,
      title: 'Fresher Warm-up Round',
      durationMins: 60,
      status: 'draft',
      visibility: 'campus',
      scoringMode: 'acm',
      problems: {
        create: [
          { code: 'CF 1873A', title: 'Short Sort', difficulty: 'easy', points: 100, order: 0 },
          { code: 'LC 704', title: 'Binary Search', difficulty: 'easy', points: 100, order: 1 },
        ],
      },
    },
  })

  const scheduled = await prisma.contest.create({
    data: {
      campusId: campus.id,
      createdById: admin.id,
      title: 'Weekly Sync Cup #15',
      durationMins: 90,
      startAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2),
      status: 'scheduled',
      visibility: 'campus',
      scoringMode: 'acm',
      problems: {
        create: [
          { code: 'CF 1902B', title: 'Two Permutations', difficulty: 'easy', points: 100, order: 0 },
          { code: 'LC 102', title: 'Binary Tree Zigzag', difficulty: 'med', points: 300, order: 1 },
          { code: 'CF 1930B', title: 'Dynamic Increments', difficulty: 'med', points: 350, order: 2 },
        ],
      },
    },
  })

  const live = await prisma.contest.create({
    data: {
      campusId: campus.id,
      createdById: admin.id,
      title: 'Weekly Sync Cup #14',
      durationMins: 60,
      startAt: new Date(Date.now() - 1000 * 60 * 20),
      status: 'live',
      visibility: 'campus',
      scoringMode: 'acm',
      problems: {
        create: [
          { code: 'CF 1873A', title: 'Short Sort', difficulty: 'easy', points: 100, order: 0 },
          { code: 'LC 704', title: 'Binary Search', difficulty: 'easy', points: 150, order: 1 },
          { code: 'LC 102', title: 'Binary Tree Zigzag', difficulty: 'med', points: 300, order: 2 },
        ],
      },
    },
  })

  console.log({ campus: campus.name, admin: admin.email, students: STUDENTS.length, contests: [draft.title, scheduled.title, live.title] })
  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
