import { describe, expect, it } from "vitest";
import { ingestErpCsv, mapRow, parseCsv } from "../erp";

describe("ERP CSV Ingestion (§4.1, §4.3)", () => {
  describe("parseCsv", () => {
    it("parses CSV with headers and values", () => {
      const csv = `
roll_number,name,department,year,cgpa
CS2601,Rahul V,CS,3,8.4
ME2602,"Kumar, Arjun",MECH,2,7.2
`;
      const rows = parseCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0].rollnumber).toBe("CS2601");
      expect(rows[0].cgpa).toBe("8.4");
      expect(rows[1].name).toBe("Kumar, Arjun");
      expect(rows[1].department).toBe("MECH");
    });
  });

  describe("mapRow", () => {
    it("maps varied header formats into standardized ErpRow", () => {
      const raw = {
        studentid: "SYN26001",
        studentname: "Ananya S",
        dept: "mech",
        yearofstudy: "2",
        gpa: "8.75",
        attendance: "82.5",
        dob: "2007-04-12",
      };
      const mapped = mapRow(raw);
      expect(mapped).not.toBeNull();
      expect(mapped?.rollNumber).toBe("SYN26001");
      expect(mapped?.name).toBe("Ananya S");
      expect(mapped?.departmentCode).toBe("MECH");
      expect(mapped?.year).toBe(2);
      expect(mapped?.cgpa).toBe(8.75);
      expect(mapped?.attendancePct).toBe(82.5);
      expect(mapped?.dateOfBirth).toBe("2007-04-12");
    });

    it("returns null if mandatory identifiers are missing", () => {
      expect(mapRow({ name: "No Roll" })).toBeNull();
    });
  });

  describe("ingestErpCsv processing & quality validation", () => {
    const asOf = new Date("2026-10-11");

    it("marks run as STALE when CSV payload is missing or empty (§4.3)", async () => {
      const res = await ingestErpCsv("", { asOf, skipDatabase: true });
      expect(res.status).toBe("STALE");
      expect(res.checksum).toBeNull();
      expect(res.errors[0]).toContain("Missing ERP export file");
    });

    it("processes valid rows, rejects malformed roll numbers, and computes checksum", async () => {
      const csv = `
roll_number,name,department,year,cgpa,attendance_pct,date_of_birth
SYN26001,Arjun Kumar,MECH,2,7.40,81.0,2006-05-10
INVALID_ROLL_123,Bad Student,CS,1,6.50,75.0,2008-01-01
SYN26002,Sneha Iyer,CS,3,9.20,88.0,2005-11-20
`;
      const res = await ingestErpCsv(csv, { asOf, skipDatabase: true });
      expect(res.status).toBe("COMPLETED");
      expect(res.checksum).toBeDefined();
      expect(res.checksum?.length).toBe(64); // SHA-256
      expect(res.rowsTotal).toBe(3);
      expect(res.rowsAccepted).toBe(2);
      expect(res.rowsRejected).toBe(1);
      expect(res.errors.some((e) => e.includes("INVALID_ROLL_123"))).toBe(true);
    });

    it("handles invalid CGPA by excluding from scoring without rejecting the student", async () => {
      const csv = `
roll_number,name,department,year,cgpa,attendance_pct,date_of_birth
SYN26003,Priya R,COMM,2,14.50,85.0,2006-03-15
`;
      const res = await ingestErpCsv(csv, { asOf, skipDatabase: true });
      expect(res.rowsAccepted).toBe(1);
      expect(res.rowsRejected).toBe(0);
      expect(res.errors.some((e) => e.includes("CGPA 14.5 outside 0–10"))).toBe(true);
    });
  });
});
