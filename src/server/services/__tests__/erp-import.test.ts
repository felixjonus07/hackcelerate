/** Nightly ERP import (§6.2) against a real database: checksum, rejects, upserts, stale marking. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import { attendanceWeeks, ingestionRuns, students } from "../../db/schema";
import { dbAvailable } from "../../testing/db";
import { insertStudent } from "../../testing/fixtures";
import { importErp } from "../erp-import";

const up = await dbAvailable();
const fixture = (name: string) =>
  // Roll numbers are renamed so these rows cannot collide with another test file's students.
  readFileSync(join(__dirname, "../../ingestion/__tests__/fixtures", name), "utf8").replaceAll("SYN26", "ERP2");

const roll = (n: number) => `ERP2${String(n).padStart(3, "0")}`;

describe.skipIf(!up)("ERP import", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const n of [1, 2, 3]) ids[roll(n)] = (await insertStudent(db, { rollNumber: roll(n), cgpa: 5 })).id;
  });
  beforeEach(async () => {
    await db.delete(ingestionRuns);
    await db.update(students).set({ erpStale: false, erpImportedAt: null });
  });

  const student = async (n: number) =>
    (
      await db
        .select()
        .from(students)
        .where(eq(students.id, ids[roll(n)]))
    )[0];

  it("imports baseline and attendance and records the run", async () => {
    const r = await importErp({ fileName: "erp.csv", text: fixture("erp-good.csv") });
    expect(r).toMatchObject({ status: "OK", rowsTotal: 5, rowsAccepted: 5, rowsRejected: 0 });
    expect(r.changedStudentIds).toHaveLength(3);

    const s1 = await student(1);
    expect(s1).toMatchObject({
      cgpa: 7.4,
      activeBacklogs: 0,
      creditsHeld: 120,
      dateOfBirth: "2005-03-02",
      erpStale: false,
    });
    expect(s1.erpImportedAt).toBeInstanceOf(Date);
    // 27 of 30 classes across two courses and two weeks.
    expect(s1.attendancePct).toBe(90);
    expect(
      await db
        .select()
        .from(attendanceWeeks)
        .where(eq(attendanceWeeks.studentId, ids[roll(1)])),
    ).toHaveLength(3);

    const [run] = await db.select().from(ingestionRuns);
    expect(run).toMatchObject({ status: "OK", rowsTotal: 5, rowsAccepted: 5, fileName: "erp.csv" });
    expect(run.fileChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports an identical file as UNCHANGED and touches nothing", async () => {
    await importErp({ fileName: "erp.csv", text: fixture("erp-good.csv") });
    const before = (await student(1)).erpImportedAt;
    const again = await importErp({
      fileName: "erp.csv",
      text: fixture("erp-good.csv"),
      now: new Date(Date.now() + 86_400_000),
    });
    expect(again.status).toBe("UNCHANGED");
    expect(again.changedStudentIds).toEqual([]);
    expect(again.errors[0]).toMatch(/identical/);
    expect((await student(1)).erpImportedAt).toEqual(before);
  });

  it("replaces a re-sent week instead of duplicating it", async () => {
    await importErp({ fileName: "erp.csv", text: fixture("erp-good.csv") });
    const edited = fixture("erp-good.csv").replace(
      "ERP2001,7.40,0,2005-03-02,120,ME301,2026-10-12,10,10",
      "ERP2001,7.40,0,2005-03-02,120,ME301,2026-10-12,10,5",
    );
    const r = await importErp({ fileName: "erp.csv", text: edited });
    expect(r.status).toBe("OK");
    const weeks = await db
      .select()
      .from(attendanceWeeks)
      .where(eq(attendanceWeeks.studentId, ids[roll(1)]));
    expect(weeks).toHaveLength(3);
    expect((await student(1)).attendancePct).toBe(73.33); // 22 of 30
    expect(r.changedStudentIds).toContain(ids[roll(1)]);
  });

  it("rejects bad rows and unknown students but imports the rest, logging each for the registrar", async () => {
    const r = await importErp({ fileName: "erp.csv", text: fixture("erp-malformed.csv") });
    expect(r.status).toBe("PARTIAL");
    expect(r.rowsRejected).toBeGreaterThanOrEqual(3);
    expect(r.errors.join("\n")).toMatch(/line 3 \(bad-roll\)/);
    expect(r.errors.join("\n")).toMatch(/no student with this roll number/);
    // ERP2001 is in the file and exists; the last row for it wins.
    expect((await student(1)).cgpa).toBe(7.5);
    const [run] = await db.select().from(ingestionRuns);
    expect(run.status).toBe("PARTIAL");
    expect(run.errors.length).toBeGreaterThan(3);
  });

  it("marks data stale when the night's file is missing, and clears it on the next good import", async () => {
    await importErp({ fileName: "erp.csv", text: fixture("erp-good.csv") });
    const missing = await importErp({ fileName: "erp.csv", text: null });
    expect(missing.status).toBe("FILE_MISSING");
    expect((await student(1)).erpStale).toBe(true);
    expect((await student(1)).cgpa).toBe(7.4); // previous values are kept
    const ok = await importErp({
      fileName: "erp.csv",
      text: fixture("erp-good.csv").replace("ERP2002,6.10", "ERP2002,6.20"),
    });
    expect(ok.status).toBe("OK");
    expect((await student(2)).erpStale).toBe(false);
    expect((await student(2)).cgpa).toBe(6.2);
  });

  it("stops on a wrong shape: nothing imported, everything marked stale", async () => {
    const r = await importErp({ fileName: "erp.csv", text: fixture("erp-missing-column.csv") });
    expect(r.status).toBe("SCHEMA_ERROR");
    expect(r.errors[0]).toMatch(/"cgpa" is missing/);
    expect((await student(1)).erpStale).toBe(true);
  });
});
