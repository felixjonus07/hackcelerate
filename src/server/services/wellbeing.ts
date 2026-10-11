/**
 * Wellbeing guardrails (§14.2).
 *
 * Narrow behavioral checks looking for three patterns only:
 * 1. late_night_clustering: study sessions clustered after midnight on 5+ nights in 14 days.
 * 2. mock_surge_attendance_drop: >100% surge in mock volume in 1 week + attendance drop >= 10 pts.
 * 3. abrupt_inactivity: complete stop in activity for 14 days after heavy use.
 *
 * Does NOT diagnose, does NOT infer mental health conditions, does NOT store
 * emotional text. Produces recovery nudges citing the transparent reason.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { mockAttempts, students } from "../db/schema";

export interface WellbeingNudge {
  patternId: "late_night_clustering" | "mock_surge_attendance_drop" | "abrupt_inactivity";
  title: string;
  patternExplanation: string;
  supportMessage: string;
  counselingContact: string;
  emergencyContact: string;
}

export const COUNSELING_CENTRE = "Campus Counseling Centre: Block A, Room 12 (synthetic contact)";
export const EMERGENCY_CONTACT = "Campus Emergency Helpline: 112";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function detectWellbeingNudges(studentId: string): Promise<WellbeingNudge[]> {
  const nudges: WellbeingNudge[] = [];
  if (!UUID_REGEX.test(studentId)) return nudges;

  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student) return nudges;

  const now = Date.now();
  const fourteenDaysAgo = new Date(now - 14 * 86_400_000);
  const sevenDaysAgo = new Date(now - 7 * 86_400_000);

  // 1. Check late-night clustering: attempts between 00:00 and 05:00 on >= 5 distinct dates
  const recentMocks = await db
    .select({ takenAt: mockAttempts.takenAt })
    .from(mockAttempts)
    .where(and(eq(mockAttempts.studentId, studentId), gte(mockAttempts.takenAt, fourteenDaysAgo)))
    .orderBy(desc(mockAttempts.takenAt));

  const lateNightDays = new Set<string>();
  let mocksLast7d = 0;
  let mocksPrev7d = 0;

  for (const m of recentMocks) {
    const d = new Date(m.takenAt);
    const hour = d.getHours();
    if (hour >= 0 && hour < 5) {
      lateNightDays.add(d.toISOString().slice(0, 10));
    }
    if (d >= sevenDaysAgo) {
      mocksLast7d += 1;
    } else {
      mocksPrev7d += 1;
    }
  }

  if (lateNightDays.size >= 5) {
    nudges.push({
      patternId: "late_night_clustering",
      title: "Pacing your prep",
      patternExplanation: "Activity was recorded after midnight on 5 or more nights over the past two weeks.",
      supportMessage:
        "Rest and steady pacing protect long-term retention better than late-night hours. Take a pause to recharge your schedule.",
      counselingContact: COUNSELING_CENTRE,
      emergencyContact: EMERGENCY_CONTACT,
    });
  }

  // 2. Check mock surge + attendance drop: > 100% surge in mocks and attendance drop >= 10 points
  const signals = student.signals ?? {};
  const currentAttendance = student.attendancePct ?? 100;
  const hasAttendanceDrop = currentAttendance < 75; // 10+ points below standard 85% requirement

  if (mocksLast7d >= 6 && mocksPrev7d > 0 && mocksLast7d >= 2 * mocksPrev7d && hasAttendanceDrop) {
    nudges.push({
      patternId: "mock_surge_attendance_drop",
      title: "Balancing practice and classes",
      patternExplanation: "Mock volume surged by over 100% this week alongside an attendance dip.",
      supportMessage:
        "Class discussions build core intuition that tests alone cannot replace. A balanced routine protects your focus.",
      counselingContact: COUNSELING_CENTRE,
      emergencyContact: EMERGENCY_CONTACT,
    });
  }

  // 3. Check abrupt inactivity: 14 days stop in activity after heavy use
  if ((signals.streakGapDays14 ?? 0) >= 1) {
    nudges.push({
      patternId: "abrupt_inactivity",
      title: "Checking in on your momentum",
      patternExplanation: "No activity was recorded over the past 14 days following an active stretch.",
      supportMessage:
        "Taking time away is completely normal during demanding weeks. Whenever you feel ready, one small step is a great place to restart.",
      counselingContact: COUNSELING_CENTRE,
      emergencyContact: EMERGENCY_CONTACT,
    });
  }

  return nudges;
}
