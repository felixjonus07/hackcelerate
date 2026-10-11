/**
 * Writes a sample ERP export from the seeded (synthetic) students, with a few
 * deliberately malformed rows, so the nightly import can be tried end to end.
 *
 *   npm run erp:sample [-- out.csv]     (default .local-data/erp/export.csv)
 *   ERP_EXPORT_FILE=.local-data/erp/export.csv npm run worker
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { db, pg } from "../src/server/db";
import { studentIdentities, students } from "../src/server/db/schema";
import { loadPolicyFile } from "../src/server/policy/file";
import { addDays, localDate, mondayOf } from "../src/server/rules/calendar";

const out = process.argv[2] ?? ".local-data/erp/export.csv";
const policy = loadPolicyFile();
const thisMonday = mondayOf(localDate(new Date(), policy.calendar));
const WEEKS = policy.data_quality.attendance_window_weeks;

/** Stable 0..1 noise from a roll number, so the sample is reproducible. */
const noise = (key: string) => parseInt(createHash("sha256").update(key).digest("hex").slice(0, 6), 16) / 0xffffff;

async function main() {
  const rows = await db
    .select({
      roll: studentIdentities.rollNumber,
      cgpa: students.cgpa,
      backlogs: students.activeBacklogs,
      dob: students.dateOfBirth,
      credits: students.creditsHeld,
      pct: students.attendancePct,
    })
    .from(studentIdentities)
    .innerJoin(students, eq(students.id, studentIdentities.studentId))
    .orderBy(studentIdentities.rollNumber);

  const lines = [
    "roll_number,cgpa,active_backlogs,date_of_birth,credits_held,course,week_start,classes_held,classes_attended",
  ];
  for (const r of rows) {
    for (let w = WEEKS - 1; w >= 0; w--) {
      const weekStart = addDays(thisMonday, -7 * w);
      if (weekStart < mondayOf(policy.calendar.term.start)) continue;
      for (const course of ["COURSE-A", "COURSE-B"]) {
        const held = 10;
        const target = (r.pct ?? 80) / 100 + (noise(`${r.roll}${weekStart}${course}`) - 0.5) * 0.1;
        const attended = Math.max(0, Math.min(held, Math.round(held * target)));
        lines.push(
          [r.roll, r.cgpa ?? "", r.backlogs, r.dob ?? "", r.credits ?? 120, course, weekStart, held, attended].join(
            ",",
          ),
        );
      }
    }
  }
  // Rows the registrar should see in the rejection log (§4.3).
  const first = rows[0]?.roll ?? "SYN26000";
  lines.push(`not-a-roll,7.0,0,2005-01-01,100,COURSE-A,${thisMonday},10,9`);
  lines.push(`${first},7.0,0,2005-01-01,100,COURSE-A,${thisMonday},0,0`);
  lines.push(`${first},7.0,0,2005-01-01,100,COURSE-B,${thisMonday},10,12`);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`);
  console.log(`Wrote ${lines.length - 1} rows for ${rows.length} students to ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
