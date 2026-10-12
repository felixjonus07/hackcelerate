/** ERP export parsing (§6.2) against recorded sample files, including malformed rows. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import { parseCsv } from "../csv";
import { checksumOf, groupByStudent, parseErpFile, resolveColumns } from "../erp";

const policy = loadPolicyFile();
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("CSV reader", () => {
  it("reads quoted fields, doubled quotes and embedded commas and newlines", () => {
    expect(parseCsv('a,"b,c","say ""hi""","line1\nline2"\n1,2,3,4\n')).toEqual([
      ["a", "b,c", 'say "hi"', "line1\nline2"],
      ["1", "2", "3", "4"],
    ]);
  });
  it("accepts CRLF, a BOM, blank lines and a missing final newline", () => {
    expect(parseCsv("﻿a,b\r\n\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("keeps empty fields", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });
  it("rejects a file that ends inside a quote", () => {
    expect(() => parseCsv('a,"b')).toThrow(/quoted/);
  });
});

describe("column mapping", () => {
  it("accepts the documented aliases, ignoring case and spacing", () => {
    const cols = resolveColumns(["Roll_No", "CGPA", "Week Start"], policy.ingestion.erp_columns);
    expect(cols).toEqual({ roll_number: 0, cgpa: 1, week_start: 2 });
  });
  it("reads a file with alternative headers, a BOM and CRLF", () => {
    const f = parseErpFile(fixture("erp-alt-headers.csv"), policy);
    expect(f.schemaErrors).toEqual([]);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ rollNumber: "SYN26001", cgpa: 7.4, creditsHeld: 120 });
    // 2026-10-07 is a Wednesday: the week is keyed by its Monday.
    expect(f.rows[0].attendance).toEqual({ course: "ME301", weekStart: "2026-10-05", held: 10, attended: 9 });
  });
  it("never reads unmapped columns", () => {
    const f = parseErpFile(fixture("erp-good.csv"), policy);
    expect(JSON.stringify(f.rows)).not.toContain("X-11");
  });
});

describe("a good file", () => {
  const f = parseErpFile(fixture("erp-good.csv"), policy);
  it("accepts every row", () => {
    expect(f.rowsTotal).toBe(5);
    expect(f.rows).toHaveLength(5);
    expect(f.rejected).toEqual([]);
    expect(f.warnings).toEqual([]);
  });
  it("groups the rows of one student and keeps each course-week", () => {
    const by = groupByStudent(f.rows);
    expect(by.map((s) => s.rollNumber)).toEqual(["SYN26001", "SYN26002", "SYN26003"]);
    expect(by[0].weeks).toHaveLength(3);
    expect(by[2].weeks).toHaveLength(0); // a student-level row with no attendance columns filled
    expect(by[2].dateOfBirth).toBe("2009-01-15");
  });
  it("has a stable checksum that changes with any byte", () => {
    expect(f.checksum).toBe(checksumOf(fixture("erp-good.csv")));
    expect(checksumOf("a")).not.toBe(checksumOf("a "));
  });
});

describe("malformed rows (§4.3)", () => {
  const f = parseErpFile(fixture("erp-malformed.csv"), policy);
  const rejected = new Map(f.rejected.map((r) => [r.line, r.reason]));
  const warned = f.warnings.map((w) => `${w.line}:${w.reason}`);

  it("rejects bad and blank roll numbers, naming the line for the registrar", () => {
    expect(rejected.get(3)).toMatch(/does not match the ERP format/);
    expect(rejected.get(4)).toMatch(/does not match the ERP format/);
    expect(f.rejected.find((r) => r.line === 4)?.rollNumber).toBe("(blank)");
  });
  it("rejects a non-numeric CGPA and only warns about a negative backlog count", () => {
    expect(rejected.get(5)).toMatch(/not a number/);
    expect(warned.some((w) => w.startsWith("10:") && /backlogs/i.test(w))).toBe(true);
  });
  it("keeps an off-scale CGPA so the quality rules can name it later", () => {
    expect(f.rows.find((r) => r.rollNumber === "SYN26005")?.cgpa).toBe(11.5);
  });
  it("drops a date of birth that is not yyyy-mm-dd but imports the row", () => {
    expect(warned.some((w) => w.startsWith("7:") && /date of birth/i.test(w))).toBe(true);
    expect(f.rows.find((r) => r.rollNumber === "SYN26006")?.dateOfBirth).toBeNull();
  });
  it("excludes invalid attendance weeks without dropping the student", () => {
    expect(warned.some((w) => w.startsWith("8:") && /greater than 0/.test(w))).toBe(true);
    expect(warned.some((w) => w.startsWith("9:") && /exceed/.test(w))).toBe(true);
    expect(warned.some((w) => w.startsWith("11:") && /course or week_start/.test(w))).toBe(true);
    expect(warned.some((w) => w.startsWith("12:") && /course or week_start/.test(w))).toBe(true);
    expect(f.rows.find((r) => r.rollNumber === "SYN26007")?.attendance).toBeNull();
  });
  it("reads quoted fields", () => {
    const r = f.rows.find((x) => x.rollNumber === "SYN26012");
    expect(r?.cgpa).toBe(8);
    expect(r?.attendance?.course).toBe("ME301, Lab");
  });
  it("notes when one student's rows disagree and takes the last value", () => {
    const s = groupByStudent(f.rows).find((x) => x.rollNumber === "SYN26001");
    expect(s?.cgpa).toBe(7.5);
    expect(s?.notes.join(" ")).toMatch(/CGPA differs/);
    expect(s?.notes.join(" ")).toMatch(/appears twice/);
    expect(s?.weeks).toHaveLength(1);
    expect(s?.weeks[0].attended).toBe(10);
  });
});

describe("schema errors stop the import", () => {
  it("reports a missing required column", () => {
    const f = parseErpFile(fixture("erp-missing-column.csv"), policy);
    expect(f.schemaErrors[0]).toMatch(/"cgpa" is missing/);
    expect(f.rows).toEqual([]);
  });
  it("reports half of the attendance columns", () => {
    const f = parseErpFile("roll_number,cgpa,course\nSYN26001,7,ME301\n", policy);
    expect(f.schemaErrors.join(" ")).toMatch(/Attendance columns must come together/);
  });
  it("reports an empty file and broken CSV", () => {
    expect(parseErpFile("", policy).schemaErrors).toEqual(["The file is empty"]);
    expect(parseErpFile('roll_number,cgpa\n"SYN26001,7', policy).schemaErrors[0]).toMatch(/quoted/);
  });
});
