/**
 * ERP export parsing and validation (§6.2, §4.3), without any I/O. The registrar's
 * nightly CSV is read through the header mapping in `policy.ingestion.erp_columns`,
 * so only mapped columns are ever looked at (§13.4 minimization). The service in
 * `services/erp-import.ts` applies the result to the database.
 */
import { createHash } from "node:crypto";
import type { Policy } from "../policy/schema";
import { ERP_REQUIRED_FIELDS } from "../policy/schema";
import { mondayOf } from "../rules/calendar";
import { parseCsv } from "./csv";
import { checkAttendanceWeek, checkRollNumber } from "./quality";

export const ERP_FIELDS = [
  "roll_number",
  "cgpa",
  "active_backlogs",
  "date_of_birth",
  "credits_held",
  "course",
  "week_start",
  "classes_held",
  "classes_attended",
] as const;
export type ErpField = (typeof ERP_FIELDS)[number];

export interface ErpRow {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  rollNumber: string;
  cgpa: number | null;
  activeBacklogs: number | null;
  dateOfBirth: string | null;
  creditsHeld: number | null;
  /** Present together, or not at all. */
  attendance: { course: string; weekStart: string; held: number; attended: number } | null;
}

export interface RowIssue {
  line: number;
  rollNumber: string;
  reason: string;
}

export interface ParsedErpFile {
  checksum: string;
  rowsTotal: number;
  rows: ErpRow[];
  /** Rows that cannot be imported (§4.3 "Row rejected at import and logged for the registrar"). */
  rejected: RowIssue[];
  /** Imported, but part of the row was dropped (an invalid attendance week, a bad date of birth). */
  warnings: RowIssue[];
  /** The file's shape is wrong (a required column is missing); nothing may be imported. */
  schemaErrors: string[];
}

export const checksumOf = (text: string) => createHash("sha256").update(text).digest("hex");

/** Map each field to the index of the first header that matches one of its aliases. */
export function resolveColumns(
  headers: string[],
  mapping: Policy["ingestion"]["erp_columns"],
): Partial<Record<ErpField, number>> {
  const norm = headers.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  const out: Partial<Record<ErpField, number>> = {};
  for (const field of ERP_FIELDS) {
    const idx = norm.findIndex((h) => (mapping[field] ?? []).includes(h));
    if (idx >= 0) out[field] = idx;
  }
  return out;
}

type Num = { ok: true; value: number | null } | { ok: false; error: string };

const num = (raw: string | undefined): Num => {
  const t = (raw ?? "").trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `"${t}" is not a number` };
};

export function parseErpFile(text: string, policy: Pick<Policy, "ingestion" | "data_quality">): ParsedErpFile {
  const checksum = checksumOf(text);
  const empty = { checksum, rowsTotal: 0, rows: [], rejected: [], warnings: [] };
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    return { ...empty, schemaErrors: [e instanceof Error ? e.message : "The file is not valid CSV"] };
  }
  if (table.length === 0) return { ...empty, schemaErrors: ["The file is empty"] };

  const cols = resolveColumns(table[0], policy.ingestion.erp_columns);
  const schemaErrors: string[] = ERP_REQUIRED_FIELDS.filter((f) => cols[f] === undefined).map(
    (f) => `Required column "${f}" is missing (accepted headers: ${policy.ingestion.erp_columns[f]?.join(", ")})`,
  );
  const attendanceCols = ["course", "week_start", "classes_held", "classes_attended"] as const;
  const present = attendanceCols.filter((f) => cols[f] !== undefined);
  if (present.length > 0 && present.length < attendanceCols.length)
    schemaErrors.push(
      `Attendance columns must come together; missing ${attendanceCols.filter((f) => cols[f] === undefined).join(", ")}`,
    );
  if (schemaErrors.length) return { ...empty, rowsTotal: table.length - 1, schemaErrors };

  const get = (r: string[], f: ErpField) => (cols[f] === undefined ? undefined : r[cols[f] as number]);
  const rows: ErpRow[] = [];
  const rejected: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const line = i + 1;
    const roll = (get(r, "roll_number") ?? "").trim();
    const reject = (reason: string) => rejected.push({ line, rollNumber: roll || "(blank)", reason });
    const warn = (reason: string) => warnings.push({ line, rollNumber: roll, reason });

    const rollCheck = checkRollNumber(roll, policy.data_quality.roll_number_pattern);
    if (!rollCheck.ok) {
      reject(rollCheck.reason);
      continue;
    }
    const cgpa = num(get(r, "cgpa"));
    const backlogs = num(get(r, "active_backlogs"));
    const credits = num(get(r, "credits_held"));
    if (!cgpa.ok || !backlogs.ok || !credits.ok) {
      reject([cgpa, backlogs, credits].flatMap((x) => (x.ok ? [] : [x.error]))[0]);
      continue;
    }
    // numeric(4,2): a value that cannot even be stored is dropped; one merely off-scale is kept so quality rules can name it.
    let cgpaValue = cgpa.value;
    if (cgpaValue != null && Math.abs(cgpaValue) >= 100) {
      warn(`CGPA ${cgpaValue} is not storable and was dropped`);
      cgpaValue = null;
    }
    let backlogsValue = backlogs.value;
    if (backlogsValue != null && (!Number.isInteger(backlogsValue) || backlogsValue < 0)) {
      warn("Active backlogs must be a whole number of at least 0");
      backlogsValue = null;
    }
    let creditsValue = credits.value;
    if (creditsValue != null && (!Number.isInteger(creditsValue) || creditsValue < 0)) {
      warn("Credits held must be a whole number of at least 0");
      creditsValue = null;
    }
    let dob: string | null = (get(r, "date_of_birth") ?? "").trim() || null;
    if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)))) {
      warn(`Date of birth "${dob}" is not a yyyy-mm-dd date and was dropped`);
      dob = null;
    }

    let attendance: ErpRow["attendance"] = null;
    if (present.length === attendanceCols.length) {
      const course = (get(r, "course") ?? "").trim();
      const week = (get(r, "week_start") ?? "").trim();
      const held = num(get(r, "classes_held"));
      const attended = num(get(r, "classes_attended"));
      const anyGiven = course || week || (held.ok && held.value != null) || (attended.ok && attended.value != null);
      if (anyGiven) {
        const validWeek = /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(week));
        if (!course || !validWeek) warn("Attendance week excluded: course or week_start is missing or invalid");
        else if (!held.ok || !attended.ok || held.value == null || attended.value == null)
          warn("Attendance week excluded: classes_held and classes_attended must be numbers");
        else {
          const check = checkAttendanceWeek(held.value, attended.value);
          if (!check.ok) warn(`Attendance week excluded: ${check.reason}`);
          else attendance = { course, weekStart: mondayOf(week), held: held.value, attended: attended.value };
        }
      }
    }
    rows.push({
      line,
      rollNumber: roll,
      cgpa: cgpaValue,
      activeBacklogs: backlogsValue,
      dateOfBirth: dob,
      creditsHeld: creditsValue,
      attendance,
    });
  }
  return { checksum, rowsTotal: table.length - 1, rows, rejected, warnings, schemaErrors: [] };
}

export interface StudentImport {
  rollNumber: string;
  cgpa: number | null;
  activeBacklogs: number | null;
  dateOfBirth: string | null;
  creditsHeld: number | null;
  weeks: { course: string; weekStart: string; held: number; attended: number }[];
  /** Notes about values that disagreed between the rows of one student. */
  notes: string[];
}

/** Fold the rows of one student: the last non-empty value wins; a repeated course-week is replaced. */
export function groupByStudent(rows: readonly ErpRow[]): StudentImport[] {
  const by = new Map<string, StudentImport>();
  for (const r of rows) {
    const s = by.get(r.rollNumber) ?? {
      rollNumber: r.rollNumber,
      cgpa: null,
      activeBacklogs: null,
      dateOfBirth: null,
      creditsHeld: null,
      weeks: [],
      notes: [],
    };
    const take = <K extends "cgpa" | "activeBacklogs" | "dateOfBirth" | "creditsHeld">(k: K, label: string) => {
      const v = r[k];
      if (v == null) return;
      if (s[k] != null && s[k] !== v)
        s.notes.push(`${label} differs between rows (line ${r.line}); the last value is used`);
      (s as Record<K, unknown>)[k] = v;
    };
    take("cgpa", "CGPA");
    take("activeBacklogs", "Active backlogs");
    take("dateOfBirth", "Date of birth");
    take("creditsHeld", "Credits held");
    if (r.attendance) {
      const a = r.attendance;
      const i = s.weeks.findIndex((w) => w.course === a.course && w.weekStart === a.weekStart);
      if (i >= 0) {
        s.notes.push(`${a.course} week ${a.weekStart} appears twice (line ${r.line}); the last row is used`);
        s.weeks[i] = a;
      } else s.weeks.push(a);
    }
    by.set(r.rollNumber, s);
  }
  return [...by.values()];
}
