/** Row builders for database tests. Pass a transaction from `inRollback` so nothing outlives the test. */
import type { db } from "../db";
import {
  departments,
  evaluations,
  staffAssignments,
  studentIdentities,
  students,
  user as userTable,
} from "../db/schema";
import type { Role } from "../db/schema/enums";
import { loadPolicyFile } from "../policy/file";
import { evaluate } from "../rules";
import type { StudentFacts } from "../rules/types";

export type Executor = Pick<typeof db, "insert" | "select" | "update" | "delete" | "execute" | "transaction">;

let counter = 0;
const next = () => ++counter;

export async function insertUser(x: Executor, role: Role, email = `${role}-${next()}-${Date.now()}@test.example`) {
  const id = crypto.randomUUID();
  await x.insert(userTable).values({ id, email, name: `Test ${role}`, role, emailVerified: true });
  return { id, email };
}

export async function insertStudent(
  x: Executor,
  over: Partial<typeof students.$inferInsert> & { rollNumber?: string; department?: string } = {},
) {
  const n = next();
  const department = over.departmentCode ?? over.department ?? "MECH";
  await x
    .insert(departments)
    .values({ code: department, name: department, standardsVersion: "test" })
    .onConflictDoNothing();
  const { rollNumber, department: _d, ...rest } = over;
  const [s] = await x
    .insert(students)
    .values({
      pseudonymousId: `T-${crypto.randomUUID().slice(0, 8)}-${n}`.toUpperCase(),
      departmentCode: department,
      year: 3,
      batch: "2027",
      isSynthetic: true,
      ...rest,
    })
    .returning();
  // Random, because test files run in parallel workers that share one database.
  const roll = rollNumber ?? `TST${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  await x.insert(studentIdentities).values({ studentId: s.id, rollNumber: roll, displayName: `Test Student ${n}` });
  return { ...s, rollNumber: roll };
}

export async function assign(x: Executor, staffUserId: string, studentId: string, role: Role) {
  await x.insert(staffAssignments).values({ staffUserId, studentId, role });
}

/** Insert an evaluation computed by the real engine from `facts`. */
export async function insertEvaluation(x: Executor, studentId: string, facts: StudentFacts) {
  const policy = loadPolicyFile();
  const result = evaluate(facts, policy);
  const [row] = await x
    .insert(evaluations)
    .values({
      studentId,
      policyVersion: policy.policy_version,
      engineVersion: result.engineVersion,
      inputHash: "test",
      track: result.trackScore.track,
      trackScore: result.trackScore.score,
      readiness: result.readiness,
      gapRatio: result.gapRatio,
      gapIndex: result.gapIndex,
      aegIndex: result.aegIndex,
      primaryPersona: result.primaryPersona,
      trend: result.trend.overall,
      confidence: result.trackScore.confidence,
      result,
      fallback: true,
    })
    .returning();
  return row;
}
