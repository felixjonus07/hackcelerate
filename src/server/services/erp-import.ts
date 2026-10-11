/**
 * Nightly ERP import (§6.2): parse the registrar's CSV, compare its checksum with
 * the previous night, reject rows with bad roll numbers (logged for the registrar),
 * upsert baseline and attendance, and mark data stale when the file is missing.
 * Returns the students whose baseline changed so the caller can re-evaluate them.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { attendanceWeeks, ingestionRuns, studentIdentities, students } from "../db/schema";
import { groupByStudent, parseErpFile } from "../ingestion/erp";
import { logger } from "../logger";
import { getActivePolicy } from "../policy/load";
import { mondayOf } from "../rules/calendar";

export type ErpImportStatus = "OK" | "UNCHANGED" | "PARTIAL" | "SCHEMA_ERROR" | "FILE_MISSING" | "FAILED";

export interface ErpImportResult {
  runId: string;
  status: ErpImportStatus;
  rowsTotal: number;
  rowsAccepted: number;
  rowsRejected: number;
  changedStudentIds: string[];
  errors: string[];
}

const MAX_LOGGED = 200;

async function markStale() {
  await db.update(students).set({ erpStale: true });
}

async function finish(
  runId: string,
  status: ErpImportStatus,
  counts: { total: number; accepted: number; rejected: number },
  errors: string[],
  changed: string[],
): Promise<ErpImportResult> {
  const logged =
    errors.length > MAX_LOGGED ? [...errors.slice(0, MAX_LOGGED), `…and ${errors.length - MAX_LOGGED} more`] : errors;
  await db
    .update(ingestionRuns)
    .set({
      status,
      rowsTotal: counts.total,
      rowsAccepted: counts.accepted,
      rowsRejected: counts.rejected,
      errors: logged,
      finishedAt: new Date(),
    })
    .where(eq(ingestionRuns.id, runId));
  await audit({
    actorUserId: "system",
    actorRole: "system",
    action: "ingestion.erp_import",
    entityType: "ingestion_run",
    entityId: runId,
    purpose: "erp_nightly",
    fieldsAccessed: [`status:${status}`, `accepted:${counts.accepted}`, `rejected:${counts.rejected}`],
    result: status === "OK" || status === "UNCHANGED" || status === "PARTIAL" ? "allowed" : "error",
  });
  return {
    runId,
    status,
    rowsTotal: counts.total,
    rowsAccepted: counts.accepted,
    rowsRejected: counts.rejected,
    changedStudentIds: changed,
    errors: logged,
  };
}

type ImportInput = {
  fileName: string;
  text: string | null;
  source?: "erp_nightly" | "manual";
  now?: Date;
};

/** `text` is null when the night's file could not be found. */
export async function importErp(input: ImportInput): Promise<ErpImportResult> {
  const now = input.now ?? new Date();
  const [run] = await db
    .insert(ingestionRuns)
    .values({ source: input.source ?? "erp_nightly", fileName: input.fileName, status: "RUNNING", startedAt: now })
    .returning({ id: ingestionRuns.id });
  try {
    return await runImport(run.id, input, now);
  } catch (err) {
    // The transaction rolled back, so the previous values stand; say so and flag them stale.
    logger.error({ err: String(err), file: input.fileName }, "ERP import failed");
    await markStale().catch(() => undefined);
    return finish(
      run.id,
      "FAILED",
      { total: 0, accepted: 0, rejected: 0 },
      [`Import failed: ${String(err).slice(0, 300)}`],
      [],
    );
  }
}

async function runImport(runId: string, input: ImportInput, now: Date): Promise<ErpImportResult> {
  const policy = await getActivePolicy();
  const run = { id: runId };

  if (input.text === null) {
    await markStale();
    logger.error({ file: input.fileName }, "ERP export missing; previous values kept and marked stale");
    return finish(
      run.id,
      "FILE_MISSING",
      { total: 0, accepted: 0, rejected: 0 },
      [`ERP export "${input.fileName}" was not found`],
      [],
    );
  }

  const parsed = parseErpFile(input.text, policy);
  if (parsed.schemaErrors.length) {
    await markStale();
    logger.error({ errors: parsed.schemaErrors }, "ERP export has the wrong shape; nothing imported");
    return finish(
      run.id,
      "SCHEMA_ERROR",
      { total: parsed.rowsTotal, accepted: 0, rejected: 0 },
      parsed.schemaErrors,
      [],
    );
  }
  await db.update(ingestionRuns).set({ fileChecksum: parsed.checksum }).where(eq(ingestionRuns.id, run.id));

  // The same bytes as last night usually mean the registrar's export did not refresh.
  const [previous] = await db
    .select({ checksum: ingestionRuns.fileChecksum })
    .from(ingestionRuns)
    .where(
      and(
        inArray(ingestionRuns.status, ["OK", "PARTIAL", "UNCHANGED"]),
        sql`${ingestionRuns.fileChecksum} is not null`,
      ),
    )
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(1);
  if (previous?.checksum === parsed.checksum)
    return finish(
      run.id,
      "UNCHANGED",
      { total: parsed.rowsTotal, accepted: 0, rejected: 0 },
      ["The file is identical to the previous import; the registrar's export may not have refreshed"],
      [],
    );

  const imports = groupByStudent(parsed.rows);
  const identities = await db
    .select({ id: studentIdentities.studentId, roll: studentIdentities.rollNumber })
    .from(studentIdentities)
    .where(
      inArray(
        studentIdentities.rollNumber,
        imports.map((s) => s.rollNumber),
      ),
    );
  const idByRoll = new Map(identities.map((i) => [i.roll, i.id]));

  const errors = parsed.rejected.map((r) => `line ${r.line} (${r.rollNumber}): ${r.reason}`);
  let unknownRows = 0;
  const known = imports.filter((s) => {
    if (idByRoll.has(s.rollNumber)) return true;
    unknownRows += parsed.rows.filter((r) => r.rollNumber === s.rollNumber).length;
    errors.push(`${s.rollNumber}: no student with this roll number; row rejected`);
    return false;
  });
  for (const w of parsed.warnings) errors.push(`warning, line ${w.line} (${w.rollNumber}): ${w.reason}`);
  for (const s of imports) for (const n of s.notes) errors.push(`warning, ${s.rollNumber}: ${n}`);

  const termStart = mondayOf(policy.calendar.term.start);
  const changed: string[] = [];
  await db.transaction(async (tx) => {
    const ids = known.map((s) => idByRoll.get(s.rollNumber) as string);
    const before = ids.length
      ? await tx
          .select({
            id: students.id,
            cgpa: students.cgpa,
            backlogs: students.activeBacklogs,
            dob: students.dateOfBirth,
            credits: students.creditsHeld,
            pct: students.attendancePct,
          })
          .from(students)
          .where(inArray(students.id, ids))
      : [];
    const prior = new Map(before.map((b) => [b.id, b]));

    for (const s of known) {
      const id = idByRoll.get(s.rollNumber) as string;
      await tx
        .update(students)
        .set({
          ...(s.cgpa != null ? { cgpa: s.cgpa } : {}),
          ...(s.activeBacklogs != null ? { activeBacklogs: s.activeBacklogs } : {}),
          ...(s.dateOfBirth != null ? { dateOfBirth: s.dateOfBirth } : {}),
          ...(s.creditsHeld != null ? { creditsHeld: s.creditsHeld } : {}),
          erpImportedAt: now,
          erpStale: false,
        })
        .where(eq(students.id, id));
      for (let i = 0; i < s.weeks.length; i += 200) {
        await tx
          .insert(attendanceWeeks)
          .values(
            s.weeks.slice(i, i + 200).map((w) => ({
              studentId: id,
              course: w.course,
              weekStart: w.weekStart,
              classesHeld: w.held,
              classesAttended: w.attended,
            })),
          )
          .onConflictDoUpdate({
            target: [attendanceWeeks.studentId, attendanceWeeks.course, attendanceWeeks.weekStart],
            set: { classesHeld: sql`excluded.classes_held`, classesAttended: sql`excluded.classes_attended` },
          });
      }
    }
    // Current-term attendance from the valid weeks on file (§4.3), only for students whose attendance arrived.
    const withWeeks = known.filter((s) => s.weeks.length).map((s) => idByRoll.get(s.rollNumber) as string);
    if (withWeeks.length)
      await tx.execute(sql`
        update students s set attendance_pct = round(100.0 * w.attended / w.held, 2)
        from (
          select student_id, sum(classes_attended)::numeric as attended, sum(classes_held)::numeric as held
          from attendance_weeks
          where student_id in ${withWeeks} and week_start >= ${termStart}::date and week_start <= ${policy.calendar.term.end}::date
            and classes_held > 0 and classes_attended <= classes_held
          group by student_id
        ) w
        where s.id = w.student_id and w.held > 0
      `);
    const after = ids.length
      ? await tx
          .select({
            id: students.id,
            cgpa: students.cgpa,
            backlogs: students.activeBacklogs,
            dob: students.dateOfBirth,
            credits: students.creditsHeld,
            pct: students.attendancePct,
          })
          .from(students)
          .where(inArray(students.id, ids))
      : [];
    for (const a of after) {
      const b = prior.get(a.id);
      const newWeeks = known.find((s) => idByRoll.get(s.rollNumber) === a.id)?.weeks.length ?? 0;
      if (
        !b ||
        b.cgpa !== a.cgpa ||
        b.backlogs !== a.backlogs ||
        b.dob !== a.dob ||
        b.credits !== a.credits ||
        b.pct !== a.pct ||
        newWeeks
      )
        changed.push(a.id);
    }
  });

  const rejected = parsed.rejected.length + unknownRows;
  const accepted = parsed.rowsTotal - rejected;
  return finish(
    run.id,
    rejected > 0 ? "PARTIAL" : "OK",
    { total: parsed.rowsTotal, accepted, rejected },
    errors,
    changed,
  );
}
