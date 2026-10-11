/**
 * Student passport read model (§12.1, §12.3 /student/passport). Everything
 * here is the student's own record; callers must pass the authenticated
 * student's id (never one from the URL).
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { artifacts, aspirations, quests, studentIdentities, students } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import { evaluate, whatIf } from "../rules";
import type { StudentFacts } from "../rules/types";
import { latestEvaluation } from "./evaluations";
import { loadStudentFacts } from "./facts";

export async function getPassport(studentId: string) {
  const policy = getActivePolicy();
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const [identity] = await db
    .select()
    .from(studentIdentities)
    .where(eq(studentIdentities.studentId, studentId))
    .limit(1);
  const [aspiration] = await db
    .select()
    .from(aspirations)
    .where(and(eq(aspirations.studentId, studentId), eq(aspirations.isCurrent, true)))
    .orderBy(desc(aspirations.createdAt))
    .limit(1);
  const evaluation = await latestEvaluation(studentId);
  const evidence = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.studentId, studentId))
    .orderBy(desc(artifacts.createdAt));
  const questRows = await db
    .select()
    .from(quests)
    .where(and(eq(quests.studentId, studentId), ne(quests.status, "EXPIRED")))
    .orderBy(quests.createdAt);

  const facts = await loadStudentFacts(studentId);
  // Score value of each open quest, computed by the same engine (§20.2).
  const base = evaluate(facts, policy).trackScore.score;
  const questImpact = (q: (typeof questRows)[number]): number | null => {
    if (!q.standardItem || !q.componentKey) return null;
    const sim = whatIf(
      facts,
      (f): StudentFacts => ({
        ...f,
        evidence: [
          ...f.evidence,
          {
            id: `sim-${q.id}`,
            component: q.componentKey ?? "",
            standardItem: q.standardItem ?? undefined,
            label: q.title,
            status: "VERIFIED",
          },
        ],
      }),
      policy,
    );
    return sim.trackScore.score - base;
  };

  return {
    student,
    displayName: identity?.displayName ?? "",
    aspiration,
    evaluation,
    evidence,
    quests: questRows.map((q) => ({ ...q, impact: questImpact(q) })),
    trackName: evaluation ? (policy.tracks[evaluation.track]?.name ?? evaluation.track) : null,
    policyVersion: policy.policy_version,
  };
}

export type PassportData = Awaited<ReturnType<typeof getPassport>>;

/** Facts + policy for the client-side what-if simulator (same engine, writes nothing). */
export async function getWhatIfInputs(studentId: string) {
  const policy = getActivePolicy();
  const facts = await loadStudentFacts(studentId);
  return { facts, policy };
}
