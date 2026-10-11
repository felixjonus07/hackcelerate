import { describe, expect, it } from "vitest";
import { addWorkingDays, isWorkingDay, toDateKey, workingDaysUntil } from "../time";

describe("Working-day SLA calculator (§8.1)", () => {
  it("formats dates into YYYY-MM-DD keys", () => {
    const d = new Date(2026, 9, 12); // Oct 12, 2026
    expect(toDateKey(d)).toBe("2026-10-12");
  });

  it("identifies weekends as non-working days", () => {
    const saturday = new Date(2026, 9, 10); // Oct 10, 2026 (Sat)
    const sunday = new Date(2026, 9, 11); // Oct 11, 2026 (Sun)
    const monday = new Date(2026, 9, 12); // Oct 12, 2026 (Mon)

    expect(isWorkingDay(saturday)).toBe(false);
    expect(isWorkingDay(sunday)).toBe(false);
    expect(isWorkingDay(monday)).toBe(true);
  });

  it("identifies institution holidays as non-working days", () => {
    const monday = new Date(2026, 9, 12); // Oct 12, 2026 (Mon)
    const holidays = ["2026-10-12"];

    expect(isWorkingDay(monday, holidays)).toBe(false);
    expect(isWorkingDay(new Date(2026, 9, 13), holidays)).toBe(true);
  });

  it("adds working days skipping weekends", () => {
    // Friday Oct 9, 2026 + 1 working day -> Monday Oct 12, 2026
    const friday = new Date(2026, 9, 9);
    const result = addWorkingDays(friday, 1);
    expect(toDateKey(result)).toBe("2026-10-12");

    // Friday Oct 9, 2026 + 2 working days -> Tuesday Oct 13, 2026
    const result2 = addWorkingDays(friday, 2);
    expect(toDateKey(result2)).toBe("2026-10-13");
  });

  it("adds working days skipping both weekends and institution holidays", () => {
    // Friday Oct 9, 2026 + 1 working day with Monday Oct 12 holiday -> Tuesday Oct 13, 2026
    const friday = new Date(2026, 9, 9);
    const holidays = ["2026-10-12"];
    const result = addWorkingDays(friday, 1, holidays);
    expect(toDateKey(result)).toBe("2026-10-13");

    // Friday Oct 9, 2026 + 2 working days with Oct 12, 13, 14 holidays -> Friday Oct 16, 2026
    const result2 = addWorkingDays(friday, 2, ["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(toDateKey(result2)).toBe("2026-10-16");
  });

  it("computes working days between dates", () => {
    const friday = new Date(2026, 9, 9);
    const nextFriday = new Date(2026, 9, 16);
    expect(workingDaysUntil(nextFriday, friday)).toBe(5);

    // With a holiday on Tuesday Oct 13
    expect(workingDaysUntil(nextFriday, friday, ["2026-10-13"])).toBe(4);
  });
});
