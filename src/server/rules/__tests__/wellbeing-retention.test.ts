/** Wellbeing patterns (§14.2) and the retention / erasure rules (§13.5, §13.7), as pure functions. */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import type { Calendar } from "../calendar";
import { erasureLetter, erasurePlan, retentionCutoffs } from "../retention";
import { type ActivityEvent, detectWellbeing, NUDGE_TITLE, type WellbeingThresholds } from "../wellbeing";

const policy = loadPolicyFile();
const cal: Calendar = policy.calendar;
const t = policy.wellbeing as unknown as WellbeingThresholds;
const asOf = new Date("2026-10-11T06:00:00Z");
const HOUR = 3_600_000;
const _DAY = 24 * HOUR;
/** An event at a local (IST) time `daysAgo` days back. */
const at = (daysAgo: number, istHour: number, kind = "practice"): ActivityEvent => ({
  kind,
  at: new Date(Date.UTC(2026, 9, 11 - daysAgo, istHour - 6, 30)),
});
const detect = (events: ActivityEvent[], attendance: { week: number; value: number }[] = []) =>
  detectWellbeing({ events, attendanceWeekly: attendance, asOf, calendar: cal, thresholds: t });

describe("late-night study", () => {
  const nights = (n: number) => Array.from({ length: n }, (_, i) => at(i + 1, 1)); // 01:00 IST
  it("fires on five or more nights with study after midnight in two weeks, and says so", () => {
    const r = detect(nights(5));
    expect(r.map((x) => x.pattern)).toEqual(["late_night"]);
    expect(r[0].explanation).toBe("You studied after midnight on 5 of the last 14 nights.");
  });
  it("four nights is not enough", () => {
    expect(detect(nights(4))).toEqual([]);
  });
  it("study before midnight or after 05:00, or older than the window, does not count", () => {
    const evening = Array.from({ length: 8 }, (_, i) => at(i + 1, 23));
    const morning = Array.from({ length: 8 }, (_, i) => at(i + 1, 6));
    const old = Array.from({ length: 8 }, (_, i) => at(i + 15, 1));
    expect(detect([...evening, ...morning, ...old])).toEqual([]);
  });
  it("logins alone are not study sessions", () => {
    expect(detect(Array.from({ length: 8 }, (_, i) => at(i + 1, 1, "login")))).toEqual([]);
  });
  it("two sessions on one night count as one night", () => {
    expect(detect([...nights(3), ...nights(3).map((e) => ({ ...e, at: new Date(+e.at + HOUR) }))])).toEqual([]);
  });
});

describe("mock volume spike with an attendance drop", () => {
  const week = (daysAgoStart: number, n: number) =>
    Array.from({ length: n }, (_, i) => at(daysAgoStart + (i % 6), 15, "mock"));
  const drop = [
    { week: 8, value: 84 },
    { week: 9, value: 80 },
    { week: 10, value: 72 },
  ];
  it("fires when volume more than doubles and attendance falls by 10 points or more", () => {
    const r = detect([...week(8, 3), ...week(1, 8)], drop);
    expect(r.map((x) => x.pattern)).toContain("volume_spike");
    expect(r.find((x) => x.pattern === "volume_spike")?.explanation).toBe(
      "Practice sets went from 3 to 8 in a week while attendance fell by 12 points.",
    );
  });
  it("needs both: volume alone or attendance alone does nothing", () => {
    expect(
      detect(
        [...week(8, 3), ...week(1, 8)],
        [
          { week: 9, value: 80 },
          { week: 10, value: 79 },
        ],
      ),
    ).toEqual([]);
    expect(detect([...week(8, 3), ...week(1, 5)], drop)).toEqual([]);
  });
  it("a first-ever burst is not a spike (needs a previous week to compare with)", () => {
    expect(detect(week(1, 9), drop)).toEqual([]);
  });
});

describe("a complete stop after heavy use", () => {
  const heavy = Array.from({ length: 12 }, (_, i) => at(16 + (i % 12), 15));
  it("fires after 14 quiet days that follow a busy stretch", () => {
    const r = detect(heavy);
    expect(r.map((x) => x.pattern)).toEqual(["activity_stop"]);
    expect(r[0].explanation).toMatch(/no activity for 14 days after a busy stretch of 12 sessions/);
  });
  it("not when there was no heavy use before, or when anything happened recently", () => {
    expect(detect(heavy.slice(0, 5))).toEqual([]);
    expect(detect([...heavy, at(3, 15, "login")])).toEqual([]);
  });
});

describe("what the patterns never produce", () => {
  it("only names a pattern, with a gentle title: never a label, a diagnosis or a persona", () => {
    for (const title of Object.values(NUDGE_TITLE))
      expect(title).not.toMatch(/depress|anxi|risk|failing|lazy|drifting|persona|disorder|mental/i);
    const all = [
      ...Array.from({ length: 6 }, (_, i) => at(i + 1, 1)),
      ...Array.from({ length: 12 }, (_, i) => at(16 + i, 15)),
    ];
    for (const n of detect(all))
      expect(n.explanation).not.toMatch(/depress|anxi|risk|failing|lazy|drifting|persona|mental|health/i);
  });
});

describe("retention cutoffs (§13.5)", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  const c = retentionCutoffs(policy, now);
  it("files 90 days after verification, answers 12 months, interventions 3 years, audit 7 years", () => {
    expect(c.artifactFilesVerifiedBefore.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(c.rawAnswersBefore.toISOString()).toBe("2025-10-11T00:00:00.000Z");
    expect(c.interventionsClosedBefore.toISOString()).toBe("2023-10-11T00:00:00.000Z");
    expect(c.auditBefore.toISOString()).toBe("2019-10-11T00:00:00.000Z");
  });
  it("evaluations go 12 months after graduation; ERP copies after the current academic year plus one", () => {
    expect(c.graduatedBefore).toBe("2025-10-11");
    expect(c.attendanceBefore).toBe("2025-07-27");
  });
});

describe("erasure against the retention schedule (§13.7)", () => {
  const plan = erasurePlan(policy, { hasOpenIntervention: false });
  const by = Object.fromEntries(plan.map((l) => [l.key, l]));
  it("erases what the schedule lets go, and keeps what it must, with the reason", () => {
    for (const k of ["erp_copies", "artifact_files", "evaluations", "mock_raw_answers"] as const)
      expect(by[k].action).toBe("erase_now");
    for (const k of ["interventions", "consent_history", "audit_events"] as const) {
      expect(by[k].action).toBe("keep");
      expect(by[k].reason.length).toBeGreaterThan(20);
    }
  });
  it("keeps an intervention that is still open until it is closed", () => {
    const open = erasurePlan(policy, { hasOpenIntervention: true }).find((l) => l.key === "interventions");
    expect(open?.reason).toMatch(/still open/);
  });
  it("the written outcome lists both, and points to the grievance officer", () => {
    const letter = erasureLetter(plan);
    expect(letter).toMatch(/We will erase:/);
    expect(letter).toMatch(/We must keep, and why:/);
    expect(letter).toMatch(/audit/i);
    expect(letter).toMatch(/grievance officer/);
  });
});
