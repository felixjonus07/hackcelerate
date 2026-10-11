/**
 * Wellbeing nudges (§14.2). The nightly scan looks for three behavioural patterns only; a hit becomes a
 * recovery nudge for the student (with the pattern named and campus support one tap away) and a soft note
 * to the mentor. It stores no free text and creates no persona, label or intervention.
 */
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../db";
import { activityEvents, attendanceWeeks, mockAttempts, students, wellbeingNudges } from "../db/schema";
import { assessAttendance } from "../ingestion/quality";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { diffDays, localDate, mondayOf } from "../rules/calendar";
import { detectWellbeing, type WellbeingThresholds } from "../rules/wellbeing";
import { mentorOf } from "./counseling";

const REPEAT_AFTER_DAYS = 14;

export async function scanWellbeing(studentId: string, now = new Date()) {
  const policy = await getActivePolicy();
  const since = new Date(now.getTime() - 60 * 86_400_000);
  const [acts, mocks, weeks] = await Promise.all([
    db
      .select({ at: activityEvents.at, kind: activityEvents.kind, items: activityEvents.items })
      .from(activityEvents)
      .where(and(eq(activityEvents.studentId, studentId), gte(activityEvents.at, since))),
    db
      .select({ at: mockAttempts.takenAt, items: mockAttempts.items })
      .from(mockAttempts)
      .where(and(eq(mockAttempts.studentId, studentId), gte(mockAttempts.takenAt, since))),
    db.select().from(attendanceWeeks).where(eq(attendanceWeeks.studentId, studentId)),
  ]);
  const asOf = localDate(now, policy.calendar);
  const att = assessAttendance(
    weeks.map((w) => ({ weekStart: String(w.weekStart), held: w.classesHeld, attended: w.classesAttended })),
    asOf,
    policy,
  );
  const termMonday = mondayOf(policy.calendar.term.start);
  const attendanceWeekly = att.weeks.map((w) => ({
    week: Math.round(diffDays(termMonday, w.weekStart) / 7) + 1,
    value: (w.attended / w.held) * 100,
  }));
  const nudges = detectWellbeing({
    events: [...acts, ...mocks.map((m) => ({ at: m.at, kind: "mock", items: m.items }))],
    attendanceWeekly,
    asOf: now,
    calendar: policy.calendar,
    thresholds: policy.wellbeing as unknown as WellbeingThresholds,
  });

  const created: string[] = [];
  const recentCut = new Date(now.getTime() - REPEAT_AFTER_DAYS * 86_400_000);
  for (const n of nudges) {
    const recent = await db
      .select({ id: wellbeingNudges.id })
      .from(wellbeingNudges)
      .where(
        and(
          eq(wellbeingNudges.studentId, studentId),
          eq(wellbeingNudges.pattern, n.pattern),
          gte(wellbeingNudges.createdAt, recentCut),
        ),
      )
      .limit(1);
    if (recent.length) continue; // one nudge per pattern per fortnight, so it never nags
    const [row] = await db
      .insert(wellbeingNudges)
      .values({ studentId, pattern: n.pattern, detectedOn: asOf, explanation: n.explanation })
      .returning();
    created.push(n.pattern);
    // A soft note for the mentor: that a nudge was sent, and which pattern. Never the events behind it (§13.1).
    const mentor = await mentorOf(studentId);
    if (mentor)
      await notify({
        to: { userId: mentor },
        studentId,
        template: "wellbeing_soft_note",
        vars: { pattern: n.pattern },
        related: { type: "wellbeing_nudge", id: row.id },
      });
  }
  return created;
}

export async function scanAllWellbeing(now = new Date()) {
  const ids = await db.select({ id: students.id }).from(students);
  let nudges = 0;
  for (const s of ids) nudges += (await scanWellbeing(s.id, now)).length;
  return nudges;
}

/** Open nudges for the passport: the pattern is named, and the student can dismiss it. */
export async function openNudges(studentId: string) {
  return db
    .select()
    .from(wellbeingNudges)
    .where(and(eq(wellbeingNudges.studentId, studentId), isNull(wellbeingNudges.dismissedAt)))
    .orderBy(desc(wellbeingNudges.createdAt));
}

export async function dismissNudge(studentId: string, nudgeId: string) {
  await db
    .update(wellbeingNudges)
    .set({ dismissedAt: new Date() })
    .where(and(eq(wellbeingNudges.id, nudgeId), eq(wellbeingNudges.studentId, studentId)));
}
