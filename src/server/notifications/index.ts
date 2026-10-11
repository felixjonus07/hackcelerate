/**
 * Notification service (§10.1). Events write rows to the `notifications` outbox; a worker delivers
 * them (digests, email, opt-in WhatsApp: see `digest.ts` and `transport.ts`). In-app notices need no
 * transport and appear on the recipient's screen.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { notifications, staffAssignments, staffProfiles, students } from "../db/schema";
import { renderNotice } from "./templates";

export interface NotifyInput {
  /** A specific user, or every user holding a role (scoped by student when `studentId` is set). */
  to: { userId: string } | { role: string };
  template: string;
  vars?: Record<string, string | number>;
  studentId?: string | null;
  channel?: "in_app" | "email" | "whatsapp";
  related?: { type: string; id: string };
}

type Writer = Pick<typeof db, "insert">;

export async function notify(input: NotifyInput, tx: Writer = db) {
  const [row] = await tx
    .insert(notifications)
    .values({
      recipientUserId: "userId" in input.to ? input.to.userId : null,
      recipientRole: "role" in input.to ? input.to.role : null,
      studentId: input.studentId ?? null,
      channel: input.channel ?? "in_app",
      template: input.template,
      payload: input.vars ?? {},
      relatedType: input.related?.type ?? null,
      relatedId: input.related?.id ?? null,
    })
    .returning({ id: notifications.id });
  return row.id;
}

// ── Reading notices in the app ─────────────────────────────────────────────

export interface AppNotice {
  id: string;
  template: string;
  title: string;
  body: string;
  createdAt: Date;
  read: boolean;
  relatedType: string | null;
  relatedId: string | null;
}

/**
 * Notices for one person, newest first. Addressed to them directly, or to their role: a student sees notices
 * about themselves, assigned staff see notices about their students, HODs see notices about their department,
 * and the dean sees only aggregate ones (§13.1).
 */
export async function noticesFor(user: { id: string; role: string }, limit = 20): Promise<AppNotice[]> {
  const mine = await db.select({ id: students.id }).from(students).where(eq(students.userId, user.id)).limit(1);
  let scope = sql`false`;
  if (user.role === "student") scope = mine[0] ? eq(notifications.studentId, mine[0].id) : sql`false`;
  else if (user.role === "registrar")
    scope = sql`true`; // full access to identity and baseline (§13.1)
  else if (user.role === "dean" || user.role === "auditor") scope = isNull(notifications.studentId);
  else if (user.role === "hod") {
    const [p] = await db
      .select({ d: staffProfiles.departmentCode })
      .from(staffProfiles)
      .where(eq(staffProfiles.userId, user.id))
      .limit(1);
    scope =
      and(isNull(notifications.studentId), sql`${notifications.payload}->>'department' = ${p?.d ?? ""}`) ?? sql`false`;
  } else {
    scope =
      or(
        isNull(notifications.studentId),
        inArray(
          notifications.studentId,
          db
            .select({ id: staffAssignments.studentId })
            .from(staffAssignments)
            .where(eq(staffAssignments.staffUserId, user.id)),
        ),
      ) ?? sql`false`;
  }
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.channel, "in_app"),
        or(eq(notifications.recipientUserId, user.id), and(eq(notifications.recipientRole, user.role), scope)),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    template: r.template,
    ...renderNotice(r.template, r.payload),
    createdAt: r.createdAt,
    read: Boolean(r.readAt),
    relatedType: r.relatedType,
    relatedId: r.relatedId,
  }));
}

export async function markNoticesRead(user: { id: string; role: string }) {
  const visible = await noticesFor(user, 100);
  const ids = visible.filter((n) => !n.read).map((n) => n.id);
  if (ids.length) await db.update(notifications).set({ readAt: new Date() }).where(inArray(notifications.id, ids));
}
