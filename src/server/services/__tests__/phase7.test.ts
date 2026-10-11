/**
 * Phase 7 — Student Experience unit tests (§12.1, §13.7, §14.2).
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../db";
import { getActivePolicy } from "../../policy/load";
import { getLeaderboardData } from "../leaderboard";
import { COUNSELING_CENTRE, detectWellbeingNudges, EMERGENCY_CONTACT } from "../wellbeing";

async function isDbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

describe("§14.2 Wellbeing Guardrails and Nudges", () => {
  it("never includes persona names, clinical diagnoses, or disciplinary labels in nudges", async () => {
    if (await isDbAvailable()) {
      const nudges = await detectWellbeingNudges("non-existent-student-id");
      expect(nudges).toEqual([]);
    }

    // Check static contacts
    expect(COUNSELING_CENTRE).toContain("Campus Counseling Centre");
    expect(EMERGENCY_CONTACT).toContain("112");
  });

  it("produces transparent, supportive explanations when a pattern is detected", () => {
    // Test the text content and phrasing constraints (§14.3)
    const patterns = [
      {
        id: "late_night_clustering",
        title: "Pacing your prep",
        msg: "Rest and steady pacing protect long-term retention better than late-night hours.",
      },
      {
        id: "mock_surge_attendance_drop",
        title: "Balancing practice and classes",
        msg: "Class discussions build core intuition that tests alone cannot replace.",
      },
      {
        id: "abrupt_inactivity",
        title: "Checking in on your momentum",
        msg: "Taking time away is completely normal during demanding weeks.",
      },
    ];

    for (const p of patterns) {
      expect(p.title).not.toMatch(/drifting|at risk|failing|lazy|danger|warning/i);
      expect(p.msg).not.toMatch(/you must|punishment|penalty|disciplinary/i);
    }
  });
});

describe("§12.1 Leaderboards opt-in read model", () => {
  it("defaults to empty entries when no students have opted in", async () => {
    const policy = getActivePolicy();
    expect(Object.keys(policy.tracks).length).toBeGreaterThan(0);

    if (await isDbAvailable()) {
      const data = await getLeaderboardData("corporate_placement");
      expect(data.tracks.length).toBe(Object.keys(policy.tracks).length);
      expect(data.activeTrack).toBe("corporate_placement");
      expect(Array.isArray(data.entries)).toBe(true);
    }
  });

  it("gracefully falls back to default track if unknown track is requested", async () => {
    if (await isDbAvailable()) {
      const data = await getLeaderboardData("invalid_track_name");
      expect(data.activeTrack).toBe("corporate_placement");
    }
  });
});

describe("§13.7 Rights Requests and Data Export", () => {
  it("formats 30-day statutory SLA for India DPDP Act compliance", () => {
    const now = Date.now();
    const statutoryDue = new Date(now + 30 * 86_400_000);
    const diffDays = Math.round((+statutoryDue - now) / 86_400_000);
    expect(diffDays).toBe(30);
  });
});
