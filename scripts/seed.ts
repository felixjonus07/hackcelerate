/**
 * Seeds a demo institution: one account per role, 60 SYNTHETIC students
 * (the reference plan's worked examples + Appendix D + a generated cohort),
 * the remediation library and opportunity feed, then runs every student
 * through the real evaluation pipeline.
 *
 *   npm run db:seed          (destructive: truncates all app tables first)
 */
import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { redis } from "../src/server/cache/redis";
import { db, pg } from "../src/server/db";
import * as t from "../src/server/db/schema";
import type { Role } from "../src/server/db/schema/enums";
import { loadPolicyFile } from "../src/server/policy/load";
import type { TrackId, VerificationStatus } from "../src/server/policy/schema";
import { CS_44, EE_12, ME_27, SEED_RECORDS } from "../src/server/rules/fixtures";
import type { StudentFacts } from "../src/server/rules/types";
import { runEvaluation } from "../src/server/services/evaluations";

const policy = loadPolicyFile();
// Demo password comes from .env (never hardcoded or shipped to the browser).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";
if (DEMO_PASSWORD.length < 12) {
  console.error("Set DEMO_PASSWORD in .env (at least 12 characters) before seeding.");
  process.exit(1);
}

// Deterministic PRNG so every seed produces the same cohort.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number, dp = 0) => Number((lo + rand() * (hi - lo)).toFixed(dp));

const STAFF: {
  email: string;
  name: string;
  role: Role;
  dept?: string;
  title?: string;
}[] = [
  {
    email: "mentor@aspiredge.example",
    name: "Dr. R. Meenakshi",
    role: "faculty_mentor",
    dept: "MECH",
    title: "Associate Professor, Mechanical",
  },
  {
    email: "advisor@aspiredge.example",
    name: "Prof. S. Karthik",
    role: "class_advisor",
    dept: "MECH",
    title: "Class advisor, 2027 batch",
  },
  {
    email: "placement@aspiredge.example",
    name: "Ms. Divya Raman",
    role: "placement_officer",
    title: "Placement cell",
  },
  {
    email: "ecell@aspiredge.example",
    name: "Mr. Arvind Shah",
    role: "ecell_coordinator",
    title: "E-Cell coordinator",
  },
  {
    email: "hod@aspiredge.example",
    name: "Dr. P. Lakshmi",
    role: "hod",
    dept: "MECH",
    title: "Head, Mechanical",
  },
  {
    email: "dean@aspiredge.example",
    name: "Dr. N. Venkatesh",
    role: "dean",
    title: "Dean, Academics",
  },
  {
    email: "registrar@aspiredge.example",
    name: "Mr. K. Suresh",
    role: "registrar",
    title: "Registrar",
  },
  {
    email: "auditor@aspiredge.example",
    name: "Ms. Farah Iqbal",
    role: "auditor",
    title: "External auditor",
  },
];

const DEPARTMENTS = Object.entries(policy.department_standards).map(([code, d]) => ({ code, name: d.name }));

const FIRST = [
  "Arjun",
  "Sneha",
  "Kavin",
  "Priya",
  "Rahul",
  "Ananya",
  "Vikram",
  "Meera",
  "Siddharth",
  "Nila",
  "Farhan",
  "Divya",
  "Joseph",
  "Harini",
  "Aditya",
  "Zoya",
  "Gautam",
  "Ishita",
  "Naveen",
  "Tanvi",
];
const LAST = ["Kumar", "Iyer", "Reddy", "Nair", "Sharma", "Das", "Fernandes", "Pillai", "Khan", "Menon", "Rao", "Bose"];

async function reset() {
  const tables = [
    "audit_events",
    "consent_records",
    "leaderboard_opt_ins",
    "rights_requests",
    "counseling_card_moves",
    "counseling_cards",
    "quests",
    "interventions",
    "evaluations",
    "policy_versions",
    "integrity_flags",
    "internship_records",
    "faculty_ratings",
    "mock_attempts",
    "attendance_weeks",
    "artifact_status_events",
    "artifacts",
    "staff_assignments",
    "staff_profiles",
    "aspirations",
    "student_identities",
    "students",
    "departments",
    "opportunities",
    "remediation_library",
    "ingestion_runs",
    "session",
    "account",
    "verification",
    "user",
  ];
  await db.execute(sql.raw(`TRUNCATE ${tables.map((x) => `"${x}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

async function createUser(email: string, name: string, role: Role) {
  const id = crypto.randomUUID();
  await db.insert(t.user).values({ id, email, name, role, emailVerified: true });
  await db.insert(t.account).values({
    id: crypto.randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(DEMO_PASSWORD),
  });
  return id;
}

/** Generated cohort member (synthetic). */
function generateFacts(i: number): StudentFacts & { name: string } {
  const dept = pick(DEPARTMENTS).code;
  const track: TrackId | null = pick<TrackId | null>([
    "corporate_placement",
    "corporate_placement",
    "corporate_placement",
    "corporate_placement",
    "corporate_placement",
    "corporate_placement",
    "higher_studies",
    "entrepreneurship",
    "public_service",
    null,
  ]);
  const statuses: VerificationStatus[] = [
    "VERIFIED",
    "VERIFIED",
    "ATTESTED",
    "SELF_REPORTED",
    "LIVE_UNVERIFIED",
    "UNDER_CHECK",
  ];
  const items = Object.keys(policy.department_standards[dept].items);
  const evidence = items
    .filter(() => rand() > 0.35)
    .map((item, k) => ({
      id: `gen-${i}-${k}`,
      component: "domain_practical_evidence",
      standardItem: item,
      label: policy.department_standards[dept].items[item].label,
      status: pick(statuses),
      source: "seed",
    }));
  const att = between(58, 96, 1);
  const slope = between(-3, 3, 1);
  return {
    name: `${pick(FIRST)} ${pick(LAST)}`,
    studentId: `STU-${String(1000 + i)}`,
    department: dept,
    year: pick([2, 3, 3, 4]),
    cgpa: between(5.6, 9.6, 2),
    attendancePct: att,
    aspiration: {
      track,
      targetOutcome: track ? `${policy.tracks[track]?.name} goal` : "Not yet chosen",
      targetType: track === "public_service" ? "public_service" : "sector",
      readiness: 70,
    },
    evidence,
    mocks: [],
    ratings:
      rand() > 0.3
        ? [
            {
              id: `gen-r-${i}`,
              kind: "mock_interview",
              date: "2026-09-15",
              rating: between(2, 5, 1),
              status: "ATTESTED",
            },
          ]
        : [],
    verifiedInternshipHours: rand() > 0.5 ? Math.round(between(0, 160)) : null,
    campusAptitudePercentile: rand() > 0.15 ? Math.round(between(30, 95)) : null,
    attendanceWeekly: [0, 1, 2, 3].map((w) => ({
      week: w + 1,
      value: Math.max(40, Math.min(100, att - slope * (3 - w))),
    })),
    activityLast60d: Math.round(between(0, 40)),
    verifiedProjects: Math.round(between(0, 3)),
    artifactScore: Math.round(between(30, 85)),
    cohortArtifactP75: 66,
  };
}

const REMEDIATION: {
  track: TrackId;
  dept?: string;
  component: string;
  item?: string;
  title: string;
  action: string;
  days: number;
  evidence: string;
}[] = [
  {
    track: "corporate_placement",
    dept: "MECH",
    component: "domain_practical_evidence",
    item: "gdt_assessment",
    title: "Take the timed GD&T assessment",
    action: "Complete a timed GD&T assessment on the platform, in the format used by campus screening rounds.",
    days: 14,
    evidence: "platform_timed_assessment",
  },
  {
    track: "corporate_placement",
    dept: "MECH",
    component: "domain_practical_evidence",
    item: "factory_internship_hours",
    title: "Get your factory log attested",
    action: "Ask the training office to attest your factory internship log so it counts at full weight.",
    days: 30,
    evidence: "attested_log",
  },
  {
    track: "corporate_placement",
    dept: "COMM",
    component: "domain_practical_evidence",
    item: "excel_financial_model",
    title: "Build a three-statement forecast",
    action:
      "Download a listed company's annual report, build a three-statement forecast, then walk your mentor through the assumptions.",
    days: 21,
    evidence: "faculty_rubric_review",
  },
  {
    track: "corporate_placement",
    dept: "BIOT",
    component: "domain_practical_evidence",
    item: "gcp_awareness",
    title: "Complete the GCP module",
    action: "Complete a Good Clinical Practice module and summarize two protocol deviation cases from public sources.",
    days: 21,
    evidence: "module_certificate",
  },
  {
    track: "corporate_placement",
    dept: "LAW",
    component: "domain_practical_evidence",
    item: "moot_court_citations",
    title: "Draft a moot memorial",
    action: "Draft a memorial on an arbitration question under faculty guidance for a regional moot court.",
    days: 30,
    evidence: "participation_certificate",
  },
  {
    track: "corporate_placement",
    dept: "CSE",
    component: "domain_practical_evidence",
    item: "deployed_projects",
    title: "Deploy one project publicly",
    action: "Deploy one project with a public URL and a README that explains the design trade-offs you made.",
    days: 21,
    evidence: "repository_check",
  },
  {
    track: "corporate_placement",
    dept: "EEE",
    component: "domain_practical_evidence",
    item: "signal_power_test",
    title: "Finish the signal and power test",
    action:
      "Finish a timed test on signal and power fundamentals and submit one hardware project with a bill of materials.",
    days: 21,
    evidence: "platform_timed_assessment",
  },
  {
    track: "corporate_placement",
    dept: "CIVIL",
    component: "domain_practical_evidence",
    item: "estimation_test",
    title: "Prepare a quantity take-off",
    action:
      "Prepare a quantity take-off for a sample building from drawings and check it against a published rate schedule.",
    days: 21,
    evidence: "platform_timed_assessment",
  },
  {
    track: "corporate_placement",
    component: "aptitude",
    title: "Three-week aptitude and speed plan",
    action:
      "Take one timed aptitude set every other day for three weeks; review every wrong answer with the solution key.",
    days: 21,
    evidence: "internal_test",
  },
  {
    track: "corporate_placement",
    component: "mock_interview_readiness",
    title: "Book a faculty mock interview",
    action: "Book a faculty mock interview this month and bring one project you can explain end to end.",
    days: 14,
    evidence: "faculty_rating",
  },
  {
    track: "corporate_placement",
    component: "verified_experience",
    title: "Record your internship hours",
    action: "Upload your internship letter so the placement cell can confirm hours with the company contact.",
    days: 30,
    evidence: "internship_letter",
  },
  {
    track: "public_service",
    component: "general_studies_mock",
    title: "Restart full-length GS mocks",
    action: "Take one full-length GS mock each week and log the review in the platform.",
    days: 28,
    evidence: "internal_test",
  },
  {
    track: "public_service",
    component: "mock_streak",
    title: "Build a 30-day practice streak",
    action: "Complete one 15-item practice set each day for 30 days.",
    days: 30,
    evidence: "internal_test",
  },
  {
    track: "higher_studies",
    component: "research_output",
    title: "Submit a preprint or poster",
    action: "Turn your strongest project into a poster or preprint with a faculty co-author.",
    days: 60,
    evidence: "doi_or_preprint",
  },
  {
    track: "higher_studies",
    component: "entrance_exam_readiness",
    title: "Weekly entrance practice tests",
    action: "Take one timed practice test for your target exam each week and label its source.",
    days: 28,
    evidence: "score_report",
  },
  {
    track: "entrepreneurship",
    component: "customer_validation",
    title: "Log five customer interviews",
    action: "Log five customer interviews and review the notes with your mentor.",
    days: 21,
    evidence: "interview_log",
  },
];

async function clearSessionStore() {
  // Sessions, rate-limit counters, idle timers and lockouts live in Redis.
  const keys = [...(await redis.keys("ba:*")), ...(await redis.keys("sess:act:*")), ...(await redis.keys("auth:*"))];
  if (keys.length) await redis.del(...keys);
}

async function main() {
  console.log("Resetting tables…");
  await reset();
  await clearSessionStore();

  await db.insert(t.departments).values(
    DEPARTMENTS.map((d) => ({
      ...d,
      standardsVersion: policy.policy_version,
    })),
  );
  await db.insert(t.policyVersions).values({
    version: policy.policy_version,
    status: "DRAFT",
    effectiveFrom: new Date(policy.effective_from),
    document: policy,
  });

  const staffIds: Record<string, string> = {};
  for (const s of STAFF) {
    staffIds[s.role] = await createUser(s.email, s.name, s.role);
    await db.insert(t.staffProfiles).values({
      userId: staffIds[s.role],
      departmentCode: s.dept ?? null,
      title: s.title ?? null,
    });
  }
  const studentUserId = await createUser("student@aspiredge.example", "Arjun Kumar", "student");
  const student2UserId = await createUser("student2@aspiredge.example", "Sneha Iyer", "student");

  const records: { facts: StudentFacts; name: string; userId?: string }[] = [
    { facts: ME_27, name: "Arjun Kumar", userId: studentUserId },
    { facts: CS_44, name: "Sneha Iyer", userId: student2UserId },
    { facts: EE_12, name: "Kavin Raj" },
    ...SEED_RECORDS.map((r, i) => ({
      facts: r.facts,
      name: `${FIRST[(i + 5) % FIRST.length]} ${LAST[i % LAST.length]}`,
    })),
  ];
  for (let i = 0; records.length < 60; i++) {
    const g = generateFacts(i);
    records.push({ facts: g, name: g.name });
  }

  console.log(`Inserting ${records.length} synthetic students…`);
  const studentIds: string[] = [];
  for (const [i, { facts: f, name, userId }] of records.entries()) {
    const [s] = await db
      .insert(t.students)
      .values({
        userId: userId ?? null,
        pseudonymousId: f.studentId,
        departmentCode: f.department,
        year: f.year,
        batch: String(2026 + (5 - f.year)),
        declaredTrack: f.aspiration.track,
        cgpa: f.cgpa,
        attendancePct: f.attendancePct,
        activeBacklogs: f.activeBacklogs ?? 0,
        isSynthetic: true,
        signals: {
          artifactScore: f.artifactScore ?? null,
          cohortArtifactP75: f.cohortArtifactP75 ?? null,
          verifiedProjects: f.verifiedProjects ?? 0,
          activityLast60d: f.activityLast60d ?? 0,
          mocksLast60d: f.mocksLast60d ?? 0,
          monthsToDeadline: f.monthsToDeadline ?? null,
          streakValidDays: f.streakValidDays,
          streakGapDays14: f.streakGapDays14,
          precomputed: f.precomputed,
        },
      })
      .returning();
    studentIds.push(s.id);
    await db.insert(t.studentIdentities).values({
      studentId: s.id,
      rollNumber: `SYN${String(26000 + i)}`,
      displayName: name,
    });
    await db.insert(t.aspirations).values({
      studentId: s.id,
      track: f.aspiration.track,
      targetOutcome: f.aspiration.targetOutcome,
      targetType: f.aspiration.targetType ?? null,
      targetDate: "2027-06-30",
      readiness: f.aspiration.readiness ?? policy.readiness_default,
    });
    for (const e of f.evidence) {
      await db.insert(t.artifacts).values({
        studentId: s.id,
        type: e.source === "github" ? "repository" : "lab_record",
        component: e.component,
        standardItem: e.standardItem ?? null,
        label: e.label,
        source: e.source ?? "seed",
        status: e.status,
        weight: e.weight ?? 1,
        verifiedAt: e.status === "VERIFIED" ? new Date() : null,
      });
    }
    for (const r of f.ratings) {
      await db.insert(t.facultyRatings).values({
        studentId: s.id,
        raterUserId: staffIds.faculty_mentor,
        kind: r.kind,
        rating: r.rating,
        status: r.status,
        ratedAt: new Date(r.date),
      });
    }
    if (f.verifiedInternshipHours != null) {
      await db.insert(t.internshipRecords).values({
        studentId: s.id,
        organisation: "Synthetic Industries Pvt Ltd",
        hours: f.verifiedInternshipHours,
        status: "VERIFIED",
        confirmedBy: staffIds.placement_officer,
      });
    }
    if (f.campusAptitudePercentile != null) {
      await db.insert(t.mockAttempts).values({
        studentId: s.id,
        testType: "campus_aptitude",
        items: 60,
        score: f.campusAptitudePercentile,
        percentile: f.campusAptitudePercentile,
        avgSecondsPerItem: 48,
        source: "campus",
        status: "VERIFIED",
        takenAt: new Date("2026-09-05"),
      });
    }
    for (const w of f.attendanceWeekly ?? []) {
      const weekStart = new Date("2026-09-14");
      weekStart.setDate(weekStart.getDate() + (w.week - 1) * 7);
      await db.insert(t.attendanceWeeks).values({
        studentId: s.id,
        course: "ALL",
        weekStart: weekStart.toISOString().slice(0, 10),
        classesHeld: 100,
        classesAttended: Math.round(w.value),
      });
    }
    // Mentor, class advisor and placement officer are assigned to the first 32 students.
    if (i < 32) {
      for (const role of ["faculty_mentor", "class_advisor", "placement_officer"] as const) {
        await db.insert(t.staffAssignments).values({ staffUserId: staffIds[role], studentId: s.id, role });
      }
    }
  }

  await db.insert(t.remediationLibrary).values(
    REMEDIATION.map((r) => ({
      track: r.track,
      departmentCode: r.dept ?? null,
      componentKey: r.component,
      standardItem: r.item ?? null,
      title: r.title,
      action: r.action,
      defaultTargetDays: r.days,
      requiredEvidenceType: r.evidence,
    })),
  );
  await db.insert(t.opportunities).values([
    {
      track: "corporate_placement",
      type: "assessment",
      title: "Campus GD&T screening practice round (synthetic)",
      sourceUrl: "https://example.org/opportunities/gdt-practice",
      deadline: new Date("2026-11-15"),
      verifiedBy: staffIds.placement_officer,
      verifiedAt: new Date(),
    },
    {
      track: "public_service",
      type: "exam",
      title: "Civil Services prelims (dates from the official notice only)",
      sourceUrl: "https://example.org/opportunities/civil-services",
      deadline: null,
    },
    {
      track: "entrepreneurship",
      type: "competition",
      title: "Regional student venture pitch (synthetic)",
      sourceUrl: "https://example.org/opportunities/pitch",
      deadline: new Date("2026-12-01"),
      verifiedBy: staffIds.ecell_coordinator,
      verifiedAt: new Date(),
    },
  ]);

  // Demo consent: ME-27 shares academic + evidence with placement.
  await db.insert(t.consentRecords).values([
    {
      studentId: studentIds[0],
      category: "academic_baseline",
      recipientRole: "placement_officer",
      granted: true,
      changedBy: studentUserId,
    },
    {
      studentId: studentIds[0],
      category: "artifacts_evidence",
      recipientRole: "placement_officer",
      granted: true,
      changedBy: studentUserId,
    },
    {
      studentId: studentIds[1],
      category: "artifacts_evidence",
      recipientRole: "ecell_coordinator",
      granted: true,
      changedBy: student2UserId,
    },
  ]);

  console.log("Evaluating every student (rules engine + narrative)…");
  for (const id of studentIds) await runEvaluation(id, { actorUserId: staffIds.faculty_mentor });

  // A few counseling cards for the mentor's board.
  const columns = [
    "REFERRED",
    "SCHEDULED",
    "IN_CONVERSATION",
    "PLAN_ACTIVE",
    "FOLLOW_UP_DUE",
    "REFERRED",
    "SCHEDULED",
    "CLOSED",
  ] as const;
  for (const [k, col] of columns.entries()) {
    await db.insert(t.counselingCards).values({
      studentId: studentIds[k + 2],
      mentorUserId: staffIds.faculty_mentor,
      column: col,
      position: k,
      nextDate: new Date(Date.now() + (k + 1) * 86_400_000),
      lastActivityAt: new Date(Date.now() - (k === 4 ? 16 : k) * 86_400_000),
    });
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.interventions)
    .where(sql`status = 'PENDING_APPROVAL'`);
  console.log(`Done. ${studentIds.length} students, ${n} interventions pending approval.`);
  console.log("Demo accounts use the DEMO_PASSWORD value from .env.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
    redis.disconnect();
  });
