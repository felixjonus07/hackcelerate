/**
 * ERP CSV import job (§4.1, §4.3, §10.2).
 * Handles column mapping, checksum vs previous run, roll number validation,
 * data-quality checks, and ingestion run logging.
 */

import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { attendanceWeeks, ingestionRuns, studentIdentities, students } from "../db/schema";
import { checkAttendanceWeek, checkCgpa, checkDateOfBirth, checkRollNumber } from "./quality";

export interface ErpRow {
  rollNumber: string;
  name: string;
  departmentCode: string;
  year: number;
  batch: string;
  cgpa?: number | null;
  attendancePct?: number | null;
  dateOfBirth?: string | null;
  classesHeld?: number | null;
  classesAttended?: number | null;
  weekStart?: string | null;
}

export interface IngestionResult {
  runId: string;
  status: "COMPLETED" | "SKIPPED_UNCHANGED" | "STALE" | "FAILED";
  checksum: string | null;
  rowsTotal: number;
  rowsAccepted: number;
  rowsRejected: number;
  errors: string[];
}

/** Pure parser for standard CSV content (handles commas, quotes, CRLF/LF). */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j]?.trim() ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

/** Map flexible CSV header keys to standardized ErpRow properties. */
export function mapRow(raw: Record<string, string>): ErpRow | null {
  const rollNumber = raw.rollnumber || raw.roll || raw.studentid || raw.id;
  const name = raw.name || raw.displayname || raw.studentname || "";
  const departmentCode = raw.departmentcode || raw.department || raw.dept || "";
  const yearStr = raw.year || raw.yearofstudy || "1";
  const year = Number.parseInt(yearStr, 10);
  const batch = raw.batch || `${2026 + (5 - (Number.isNaN(year) ? 1 : year))}`;

  if (!rollNumber || !departmentCode) return null;

  const cgpaRaw = raw.cgpa || raw.gpa;
  const cgpa = cgpaRaw && cgpaRaw !== "" ? Number.parseFloat(cgpaRaw) : null;

  const attRaw = raw.attendancepct || raw.attendance;
  const attendancePct = attRaw && attRaw !== "" ? Number.parseFloat(attRaw) : null;

  const dateOfBirth = raw.dateofbirth || raw.dob || null;

  const heldRaw = raw.classesheld || raw.held;
  const classesHeld = heldRaw && heldRaw !== "" ? Number.parseInt(heldRaw, 10) : null;

  const attWeeksRaw = raw.classesattended || raw.attended;
  const classesAttended = attWeeksRaw && attWeeksRaw !== "" ? Number.parseInt(attWeeksRaw, 10) : null;

  const weekStart = raw.weekstart || null;

  return {
    rollNumber,
    name,
    departmentCode: departmentCode.toUpperCase(),
    year: Number.isNaN(year) ? 1 : year,
    batch,
    cgpa,
    attendancePct,
    dateOfBirth,
    classesHeld,
    classesAttended,
    weekStart,
  };
}

/**
 * Ingest an ERP CSV export payload.
 * Tracks checksums vs previous night, rejects invalid roll numbers,
 * runs data-quality validators, and logs to ingestion_runs.
 */
export async function ingestErpCsv(
  csvContent: string | null | undefined,
  options: {
    source?: string;
    asOf?: Date;
    skipDatabase?: boolean; // useful for pure testing
  } = {},
): Promise<IngestionResult> {
  const source = options.source ?? "erp";
  const asOf = options.asOf ?? new Date();

  // 1. Check for missing file (§4.3 / Table 6.2: Missing file raises an alert and marks stale)
  if (!csvContent || !csvContent.trim()) {
    const errors = ["Missing ERP export file: payload is empty or not provided"];
    let runId = "dry-run";
    if (!options.skipDatabase) {
      const [run] = await db
        .insert(ingestionRuns)
        .values({
          source,
          fileChecksum: null,
          rowsTotal: "0",
          rowsRejected: "0",
          status: "STALE",
          errors,
          startedAt: asOf,
          finishedAt: asOf,
        })
        .returning();
      runId = run.id;
    }
    return {
      runId,
      status: "STALE",
      checksum: null,
      rowsTotal: 0,
      rowsAccepted: 0,
      rowsRejected: 0,
      errors,
    };
  }

  // 2. Compute SHA-256 Checksum
  const checksum = createHash("sha256").update(csvContent).digest("hex");

  // 3. Compare with latest ingestion run checksum
  if (!options.skipDatabase) {
    const [latestRun] = await db
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.source, source))
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(1);

    if (latestRun && latestRun.fileChecksum === checksum && latestRun.status === "COMPLETED") {
      const [skipRun] = await db
        .insert(ingestionRuns)
        .values({
          source,
          fileChecksum: checksum,
          rowsTotal: latestRun.rowsTotal ?? "0",
          rowsRejected: "0",
          status: "SKIPPED_UNCHANGED",
          errors: [],
          startedAt: asOf,
          finishedAt: asOf,
        })
        .returning();
      return {
        runId: skipRun.id,
        status: "SKIPPED_UNCHANGED",
        checksum,
        rowsTotal: Number(latestRun.rowsTotal ?? 0),
        rowsAccepted: Number(latestRun.rowsTotal ?? 0),
        rowsRejected: 0,
        errors: [],
      };
    }
  }

  // 4. Parse CSV
  const rawRows = parseCsv(csvContent);
  const errors: string[] = [];
  let rowsAccepted = 0;
  let rowsRejected = 0;

  const validParsedRows: { row: ErpRow; parentalConsentRequired: boolean; validCgpa: number | null }[] = [];

  for (let idx = 0; idx < rawRows.length; idx++) {
    const raw = rawRows[idx];
    const row = mapRow(raw);
    const rowNum = idx + 2; // header is line 1

    if (!row) {
      rowsRejected++;
      errors.push(`Row ${rowNum}: Missing mandatory fields (roll number or department)`);
      continue;
    }

    // Rule: Reject bad roll numbers (§4.3)
    const rollCheck = checkRollNumber(row.rollNumber);
    if (!rollCheck.ok) {
      rowsRejected++;
      errors.push(`Row ${rowNum}: ${rollCheck.reason}`);
      continue;
    }

    // Rule: Check CGPA
    let validCgpa = row.cgpa ?? null;
    if (row.cgpa != null) {
      const cgpaCheck = checkCgpa(row.cgpa, 10);
      if (!cgpaCheck.ok) {
        errors.push(`Row ${rowNum} (${row.rollNumber}): ${cgpaCheck.reason} - excluded from score baseline`);
        validCgpa = null;
      }
    }

    // Rule: Check Date of birth (§4.3 under-18 parental check)
    let parentalConsentRequired = false;
    if (row.dateOfBirth) {
      const dobCheck = checkDateOfBirth(row.dateOfBirth, row.year, asOf);
      if (dobCheck.ok) {
        parentalConsentRequired = dobCheck.parentalConsentRequired;
      } else {
        errors.push(`Row ${rowNum} (${row.rollNumber}): ${dobCheck.reason}`);
      }
    }

    rowsAccepted++;
    validParsedRows.push({ row, parentalConsentRequired, validCgpa });
  }

  // 5. Persist to DB if not skipped
  let runId = "dry-run";
  if (!options.skipDatabase) {
    const [runRecord] = await db
      .insert(ingestionRuns)
      .values({
        source,
        fileChecksum: checksum,
        rowsTotal: String(rawRows.length),
        rowsRejected: String(rowsRejected),
        status: "COMPLETED",
        errors,
        startedAt: asOf,
      })
      .returning();
    runId = runRecord.id;

    for (const { row, parentalConsentRequired, validCgpa } of validParsedRows) {
      // Find existing student by roll number
      const [existingIdentity] = await db
        .select()
        .from(studentIdentities)
        .where(eq(studentIdentities.rollNumber, row.rollNumber))
        .limit(1);

      if (existingIdentity) {
        // Update baseline
        await db
          .update(students)
          .set({
            cgpa: validCgpa,
            attendancePct: row.attendancePct,
            year: row.year,
            batch: row.batch,
            dateOfBirth: row.dateOfBirth,
            parentalConsentRequired,
          })
          .where(eq(students.id, existingIdentity.studentId));

        if (row.classesHeld != null && row.classesAttended != null && row.weekStart) {
          const attCheck = checkAttendanceWeek(row.classesHeld, row.classesAttended);
          if (attCheck.ok) {
            await db.insert(attendanceWeeks).values({
              studentId: existingIdentity.studentId,
              course: "CORE",
              weekStart: row.weekStart,
              classesHeld: row.classesHeld,
              classesAttended: row.classesAttended,
            });
          }
        }
      }
    }

    await db.update(ingestionRuns).set({ finishedAt: new Date() }).where(eq(ingestionRuns.id, runId));
  }

  return {
    runId,
    status: "COMPLETED",
    checksum,
    rowsTotal: rawRows.length,
    rowsAccepted,
    rowsRejected,
    errors,
  };
}
