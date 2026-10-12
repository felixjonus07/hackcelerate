/**
 * Weekly digests and delivery (§10.1, §12.2). A digest is informational: the class advisor's watch-band
 * summary needs no approval (§8.1), and a mentor's digest counts what is waiting. Students get a digest only
 * if they opted in, and WhatsApp only with an explicit opt-in and a pre-approved template.
 */
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  counselingCards,
  interventions,
  notificationPreferences,
  notifications,
  staffAssignments,
  students,
  user as userTable,
} from "../db/schema";
import { logger } from "../logger";
import { getActivePolicy } from "../policy/load";
import { localDate, mondayOf } from "../rules/calendar";
import { renderNotice } from "./templates";
import { configuredTransports, type Delivery, type Transport } from "./transport";

/** ISO week key such as "2026-10-05" (the Monday), so a digest is written once per week per person. */
const weekKey = (d: Date, cal: { utc_offset_minutes: number }) => mondayOf(localDate(d, cal));

async function alreadyHas(userId: string, key: string) {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.template, "weekly_digest"),
        eq(notifications.relatedId, key),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function addDigest(userId: string, key: string, summary: string) {
  for (const channel of ["in_app", "email"] as const)
    await db.insert(notifications).values({
      recipientUserId: userId,
      channel,
      template: "weekly_digest",
      payload: { summary },
      relatedType: "week",
      relatedId: key,
    });
}

export async function buildWeeklyDigests(now = new Date()) {
  const policy = await getActivePolicy();
  const key = weekKey(now, policy.calendar);
  const [lo, hi] = policy.attendance.watch_band_pct;
  let created = 0;

  // Class advisors: attendance watch band and critical, for their assigned students (§8.1, informational).
  const advisors = await db
    .select({ id: staffAssignments.staffUserId })
    .from(staffAssignments)
    .where(eq(staffAssignments.role, "class_advisor"))
    .groupBy(staffAssignments.staffUserId);
  for (const a of advisors) {
    if (await alreadyHas(a.id, key)) continue;
    const rows = await db
      .select({ pct: students.attendancePct })
      .from(staffAssignments)
      .innerJoin(students, eq(students.id, staffAssignments.studentId))
      .where(and(eq(staffAssignments.staffUserId, a.id), eq(staffAssignments.role, "class_advisor")));
    const watch = rows.filter((r) => r.pct != null && r.pct >= lo && r.pct <= hi).length;
    const critical = rows.filter((r) => r.pct != null && r.pct < policy.attendance.condonation_floor_pct).length;
    await addDigest(
      a.id,
      key,
      `Attendance this week: ${watch} students in the watch band (${lo} to ${hi} percent), ${critical} below ${policy.attendance.condonation_floor_pct} percent. Informational only; open Attendance for the list.`,
    );
    created++;
  }

  // Mentors: what is waiting for them.
  const mentors = await db
    .select({ id: staffAssignments.staffUserId })
    .from(staffAssignments)
    .where(eq(staffAssignments.role, "faculty_mentor"))
    .groupBy(staffAssignments.staffUserId);
  for (const m of mentors) {
    if (await alreadyHas(m.id, key)) continue;
    const mine = db
      .select({ id: staffAssignments.studentId })
      .from(staffAssignments)
      .where(eq(staffAssignments.staffUserId, m.id));
    const [pending] = await db
      .select({
        n: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) filter (where ${interventions.slaDueAt} < ${now.toISOString()}::timestamptz)::int`,
      })
      .from(interventions)
      .where(
        and(
          eq(interventions.status, "PENDING_APPROVAL"),
          eq(interventions.approverRole, "faculty_mentor"),
          inArray(interventions.studentId, mine),
        ),
      );
    const cutoff = new Date(now.getTime() - policy.counseling.inactivity_amber_days * 86_400_000);
    const [stale] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(counselingCards)
      .where(
        and(
          eq(counselingCards.mentorUserId, m.id),
          ne(counselingCards.column, "CLOSED"),
          lt(counselingCards.lastActivityAt, cutoff),
        ),
      );
    const [followUps] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(counselingCards)
      .where(and(eq(counselingCards.mentorUserId, m.id), eq(counselingCards.column, "FOLLOW_UP_DUE")));
    await addDigest(
      m.id,
      key,
      `This week: ${pending.n} proposals waiting for you (${pending.overdue} past their response time), ${followUps.n} follow-ups due, ${stale.n} cards with no activity for ${policy.counseling.inactivity_amber_days} days.`,
    );
    created++;
  }

  // Students who opted in: a short nudge to open the passport. No scores, no personal detail.
  const optedIn = await db
    .select({ userId: notificationPreferences.userId, channel: notificationPreferences.channel })
    .from(notificationPreferences)
    .innerJoin(userTable, eq(userTable.id, notificationPreferences.userId))
    .where(and(eq(notificationPreferences.optedIn, true), eq(userTable.role, "student")));
  const byUser = new Map<string, string[]>();
  for (const o of optedIn) byUser.set(o.userId, [...(byUser.get(o.userId) ?? []), o.channel]);
  for (const [userId, channels] of byUser) {
    const [dup] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, userId),
          eq(notifications.template, "weekly_passport"),
          eq(notifications.relatedId, key),
        ),
      )
      .limit(1);
    if (dup) continue;
    for (const channel of ["in_app", ...channels] as const)
      await db
        .insert(notifications)
        .values({ recipientUserId: userId, channel, template: "weekly_passport", relatedType: "week", relatedId: key });
    created++;
  }
  return created;
}

/** Deliver pending email and WhatsApp rows. WhatsApp needs an opt-in and a destination, or the row is skipped. */
export async function deliverPending(transports: Transport[] = configuredTransports(), now = new Date()) {
  const pending = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.status, "PENDING"), inArray(notifications.channel, ["email", "whatsapp"])))
    .limit(500);
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const n of pending) {
    const transport = transports.find((t) => t.channel === n.channel);
    const finish = (status: string) =>
      db
        .update(notifications)
        .set({ status, sentAt: status === "SENT" ? now : null })
        .where(eq(notifications.id, n.id));
    if (!transport || !n.recipientUserId) {
      await finish("SKIPPED");
      result.skipped++;
      continue;
    }
    let to: string | null = null;
    if (n.channel === "email") {
      to =
        (
          await db
            .select({ email: userTable.email })
            .from(userTable)
            .where(eq(userTable.id, n.recipientUserId))
            .limit(1)
        )[0]?.email ?? null;
    } else {
      const [pref] = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(eq(notificationPreferences.userId, n.recipientUserId), eq(notificationPreferences.channel, "whatsapp")),
        )
        .limit(1);
      to = pref?.optedIn ? pref.destination : null; // WhatsApp only with an explicit opt-in (§10.1)
    }
    if (!to) {
      await finish("SKIPPED");
      result.skipped++;
      continue;
    }
    const notice = renderNotice(n.template, n.payload);
    const d: Delivery = { to, title: notice.title, body: notice.body, template: n.template, vars: n.payload };
    try {
      const r = await transport.send(d);
      await finish(r.ok ? "SENT" : "FAILED");
      result[r.ok ? "sent" : "failed"]++;
    } catch (err) {
      logger.warn({ err: String(err), id: n.id }, "notification delivery failed");
      await finish("FAILED");
      result.failed++;
    }
  }
  return result;
}

export async function setPreference(
  userId: string,
  channel: "email" | "whatsapp",
  optedIn: boolean,
  destination?: string | null,
) {
  if (channel === "whatsapp" && optedIn && !/^\+?\d[\d\s-]{8,14}$/.test(destination ?? ""))
    throw new Error("Enter the WhatsApp number with its country code");
  await db
    .insert(notificationPreferences)
    .values({ userId, channel, optedIn, destination: optedIn ? (destination ?? null) : null })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.channel],
      set: { optedIn, destination: optedIn ? (destination ?? null) : null, changedAt: new Date() },
    });
}
