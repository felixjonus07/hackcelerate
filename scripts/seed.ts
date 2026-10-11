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
import { embedMissing } from "../src/server/embeddings";
import { loadPolicyFile } from "../src/server/policy/file";
import { approvalsRequired, changedSections } from "../src/server/policy/lifecycle";
import type { TrackId } from "../src/server/policy/schema";
import { addDays } from "../src/server/rules/calendar";
import { CS_44, EE_12, FIXTURE_AS_OF, ME_27, SEED_RECORDS } from "../src/server/rules/fixtures";
import { runEvaluation } from "../src/server/services/evaluations";
import { ParentalConsentRequired } from "../src/server/services/parental";
import { refreshCohortSignals } from "../src/server/services/signals";
import { FIRST, generateRecord, LAST, mulberry32, type SeedRecord } from "./seed-data";

const policy = loadPolicyFile();
// Demo password comes from .env (never hardcoded or shipped to the browser).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";
if (DEMO_PASSWORD.length < 12) {
  console.error("Set DEMO_PASSWORD in .env (at least 12 characters) before seeding.");
  process.exit(1);
}

const rand = mulberry32(2026);

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
  {
    email: "sports@aspiredge.example",
    name: "Mr. Imran Qureshi",
    role: "sports_officer",
    title: "Sports and NCC office",
  },
  {
    email: "alumni@aspiredge.example",
    name: "Ms. Nandini Rao",
    role: "alumni_mentor",
    title: "Alumni mentor (synthetic)",
  },
];

const DEPARTMENTS = Object.entries(policy.department_standards).map(([code, d]) => ({ code, name: d.name }));

async function reset() {
  const tables = [
    "audit_events",
    "audit_events_archive",
    "cohort_aggregates",
    "parental_consents",
    "demographic_profiles",
    "notice_acknowledgements",
    "wellbeing_nudges",
    "notification_preferences",
    "notifications",
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
    "milestones",
    "activity_events",
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
  // The shipped policy starts as a DRAFT: the registrar and the dean activate it (§3.3), which is the demo journey.
  await db.insert(t.policyVersions).values({
    version: policy.policy_version,
    status: "DRAFT",
    effectiveFrom: new Date(policy.effective_from),
    document: policy,
    requiresTwoApprovals: approvalsRequired(null, policy) === 2,
    changedSections: changedSections(null, policy),
  });
  // One earlier, healthy nightly import, so the registrar's ingestion status page has history (§6.2).
  await db.insert(t.ingestionRuns).values({
    source: "erp_nightly",
    fileName: "erp-export.csv",
    fileChecksum: "0".repeat(64),
    rowsTotal: 0,
    rowsAccepted: 0,
    rowsRejected: 0,
    status: "OK",
    errors: ["Seed placeholder: the demo data was generated, not imported from a file"],
    startedAt: new Date(Date.now() - 86_400_000),
    finishedAt: new Date(Date.now() - 86_400_000 + 1_000),
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

  const named = (i: number): string => `${FIRST[(i + 5) % FIRST.length]} ${LAST[i % LAST.length]}`;
  const records: (SeedRecord & { userId?: string; pinned?: string[] })[] = [
    { facts: ME_27, name: "Arjun Kumar", userId: studentUserId },
    { facts: CS_44, name: "Sneha Iyer", userId: student2UserId, pinned: ["artifactScore", "cohortArtifactP75"] },
    { facts: EE_12, name: "Kavin Raj" },
    ...SEED_RECORDS.map((r, i) => ({
      facts: r.facts,
      name: named(i),
      pinned: r.facts.cohortArtifactP75 != null ? ["artifactScore", "cohortArtifactP75"] : undefined,
    })),
  ];
  for (let i = 0; records.length < 60; i++) records.push(generateRecord(i, rand, policy));

  console.log(`Inserting ${records.length} synthetic students…`);
  const studentIds: string[] = [];
  const asOf = FIXTURE_AS_OF;
  const at = (iso: string, hour = 10) => new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00+05:30`);
  for (const [i, { facts: f, name, userId, pinned }] of records.entries()) {
    const [s] = await db
      .insert(t.students)
      .values({
        userId: userId ?? null,
        // Synthetic birth date consistent with the year of study (§4.3): about 17 + year years old.
        dateOfBirth: `${2026 - 17 - f.year - (i % 2)}-${String(1 + ((i * 5) % 12)).padStart(2, "0")}-${String(1 + ((i * 7) % 27)).padStart(2, "0")}`,
        creditsHeld: f.creditsHeld ?? 20 * f.year + 40 + (i % 17),
        erpImportedAt: new Date(),
        onboardedAt: new Date(),
        onboardingStep: 5,
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
          ...(pinned ? { pinned } : {}),
        },
      })
      .returning();
    studentIds.push(s.id);
    await db.insert(t.studentIdentities).values({
      studentId: s.id,
      rollNumber: `SYN${String(26000 + i)}`,
      displayName: name,
    });
    // The target date follows the record's months to deadline (abroad / exam triggers, §7.3).
    const targetDate = addDays(asOf, Math.round((f.monthsToDeadline ?? 8.5) * 30.4375));
    await db.insert(t.aspirations).values({
      studentId: s.id,
      track: f.aspiration.track,
      targetOutcome: f.aspiration.targetOutcome,
      targetType: f.aspiration.targetType ?? null,
      targetDate,
      readiness: f.aspiration.readiness ?? policy.readiness_default,
    });
    for (const e of f.evidence) {
      await db.insert(t.artifacts).values({
        studentId: s.id,
        type: e.kind ?? (e.source === "github" ? "repository" : "lab_record"),
        component: e.component,
        standardItem: e.standardItem ?? null,
        label: e.label,
        source: e.source ?? "seed",
        status: e.status,
        weight: e.weight ?? 1,
        details: e.details ?? {},
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
        ratedAt: at(r.date),
      });
    }
    for (const m of f.milestones ?? []) {
      await db.insert(t.milestones).values({
        studentId: s.id,
        scope: m.scope,
        title: m.title,
        dueOn: m.dueOn,
        completedOn: m.completedOn,
      });
    }
    for (const m of f.mocks) {
      await db.insert(t.mockAttempts).values({
        studentId: s.id,
        testType: m.testType,
        items: m.items,
        score: m.score ?? m.percentile,
        maxScore: m.maxScore ?? 100,
        percentile: m.percentile,
        avgSecondsPerItem: m.avgSecondsPerItem,
        targetSecondsPerItem: m.targetSecondsPerItem ?? null,
        itemKind: m.itemKind ?? null,
        difficulty: m.difficulty ?? null,
        source: m.source ?? "campus platform",
        status: m.status,
        takenAt: at(m.date),
      });
    }
    // Activity events: current-affairs sessions on their dates, plus enough logins to match the 60-day count.
    const sessions = (f.currentAffairsDates ?? []).map((d) => ({ at: at(d, 19), kind: "current_affairs", items: 10 }));
    const logins = Math.max(0, (f.activityLast60d ?? 0) - sessions.length - f.mocks.length);
    const events = [
      ...sessions,
      ...Array.from({ length: logins }, (_, k) => ({
        at: at(addDays(asOf, -((k * 3 + 1) % 58)), 9 + (k % 9)),
        kind: "login",
        items: 0,
      })),
    ];
    if (events.length) await db.insert(t.activityEvents).values(events.map((e) => ({ studentId: s.id, ...e })));
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
    // Eight weeks of attendance (the confidence window, §4.3): four from the record, earlier weeks held flat.
    const weekly = f.attendanceWeekly ?? [];
    const firstValue = weekly[0]?.value;
    for (let k = -4; k < weekly.length; k++) {
      const w = k < 0 ? firstValue : weekly[k]?.value;
      if (w == null) continue;
      await db.insert(t.attendanceWeeks).values({
        studentId: s.id,
        course: "ALL",
        weekStart: addDays("2026-09-14", k * 7),
        classesHeld: 100,
        classesAttended: Math.round(w),
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

  const embedded = await embedMissing();
  console.log(
    embedded.pending
      ? `Embeddings skipped for ${embedded.pending} catalog rows (set OPENROUTER_API_KEY to enable pgvector matching).`
      : `Embedded ${embedded.remediation} remediation rows and ${embedded.opportunities} opportunities.`,
  );

  // Two synthetic students under 18 (§4.3): one waits for a guardian's consent, one has it verified.
  const minorPending = studentIds[20];
  const minorVerified = studentIds[21];
  await db
    .update(t.students)
    .set({ dateOfBirth: "2009-03-14", year: 1 })
    .where(sql`id in (${minorPending}, ${minorVerified})`);
  await db.insert(t.parentalConsents).values({
    studentId: minorVerified,
    status: "VERIFIED",
    method: "Signed form checked against the admission record (synthetic)",
    verifiedBy: staffIds.registrar,
    verifiedAt: new Date(),
  });

  // Demographics for the fairness check (§14.1): given with consent by 50 of the 60 students, stored apart, never scored.
  await db.insert(t.demographicProfiles).values(
    studentIds.slice(0, 50).map((id, i) => ({
      studentId: id,
      mediumOfInstruction: i % 3 === 0 ? "regional" : "english",
      firstGeneration: i % 2 === 0,
      homeRegion: i % 4 === 0 ? "rural" : "urban",
      gender: i % 5 === 0 ? "f" : i % 2 === 0 ? "m" : "f",
      deviceAccess: i % 7 === 0 ? "limited" : "good",
    })),
  );
  // Leaderboards are off by default (§12.1); a few students chose to join, so the board has something to show.
  await db
    .insert(t.leaderboardOptIns)
    .values([0, 2, 5, 8, 11, 14, 17, 23].map((i) => ({ studentId: studentIds[i], optedIn: true })));

  // A student who has not onboarded yet (§12.1): their record is there, their ambition and consents are not.
  const student3UserId = await createUser("student3@aspiredge.example", "Naveen Rao", "student");
  const [s3] = await db
    .insert(t.students)
    .values({
      userId: student3UserId,
      pseudonymousId: "STU-NEW-1",
      departmentCode: "CSE",
      year: 2,
      batch: "2028",
      cgpa: 7.8,
      attendancePct: 88,
      dateOfBirth: "2006-02-11",
      creditsHeld: 70,
      erpImportedAt: new Date(),
      isSynthetic: true,
    })
    .returning();
  await db.insert(t.studentIdentities).values({ studentId: s3.id, rollNumber: "SYN26999", displayName: "Naveen Rao" });
  await db
    .insert(t.staffAssignments)
    .values({ staffUserId: staffIds.faculty_mentor, studentId: s3.id, role: "faculty_mentor" });

  // Waiting for named reviewers, so the evidence review screen has real items (§6.2): a certificate for the
  // mentor, an internship letter for the placement cell, and the internship record it supports.
  await db.insert(t.artifacts).values([
    {
      studentId: studentIds[0],
      type: "module_certificate",
      component: "domain_practical_evidence",
      standardItem: "Thermal engineering module",
      label: "Thermal engineering module certificate",
      description: "Completed the department's thermal engineering module (synthetic).",
      source: "student",
      status: "UNDER_CHECK",
      weight: 1,
    },
    {
      studentId: studentIds[0],
      type: "internship_letter",
      component: "verified_experience",
      label: "Internship letter, Synthetic Industries",
      description: "Letter confirming a four-week placement (synthetic).",
      source: "student",
      status: "UNDER_CHECK",
      weight: 1,
    },
  ]);
  await db.insert(t.internshipRecords).values({
    studentId: studentIds[0],
    organisation: "Synthetic Works Pvt Ltd",
    hours: 120,
    status: "SUBMITTED",
  });

  const sig = await refreshCohortSignals();
  console.log(`Refreshed cohort signals for ${sig.updated} of ${sig.students} students.`);

  console.log("Evaluating every student (rules engine + narrative)…");
  for (const id of studentIds) {
    try {
      await runEvaluation(id, { actorUserId: staffIds.faculty_mentor });
    } catch (e) {
      // A student under 18 without verified consent is not processed (§13.4); the registrar's queue shows them.
      if (!(e instanceof ParentalConsentRequired)) throw e;
    }
  }

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
