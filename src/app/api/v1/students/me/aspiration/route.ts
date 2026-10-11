import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { db } from "@/server/db";
import { aspirations, students } from "@/server/db/schema";
import { TRACK_IDS } from "@/server/policy/schema";
import { runEvaluation } from "@/server/services/evaluations";

const body = z.object({
  track: z.enum(TRACK_IDS),
  targetOutcome: z.string().min(3).max(200),
  targetType: z.string().max(40).optional(),
  targetDate: z.iso.date(),
  readiness: z.number().int().min(40).max(100),
  reason: z.string().max(300).optional(),
});

/** PUT /api/v1/students/me/aspiration — declare or change track, target and readiness. */
export const PUT = handle(async (req: Request) => {
  const { user, student } = await meStudent();
  const a = body.parse(await req.json());
  if (new Date(a.targetDate) <= new Date())
    return json(
      {
        error: {
          code: "invalid_request",
          message: "targetDate must be in the future",
        },
      },
      { status: 400 },
    );
  await db.transaction(async (tx) => {
    await tx
      .update(aspirations)
      .set({ isCurrent: false })
      .where(and(eq(aspirations.studentId, student.id), eq(aspirations.isCurrent, true)));
    await tx.insert(aspirations).values({
      studentId: student.id,
      track: a.track,
      targetOutcome: a.targetOutcome,
      targetType: a.targetType ?? null,
      targetDate: a.targetDate,
      readiness: a.readiness,
      changeReason: a.reason ?? null,
    });
    await tx.update(students).set({ declaredTrack: a.track }).where(eq(students.id, student.id));
  });
  const ev = await runEvaluation(student.id, { actorUserId: user.id });
  return json({ ok: true, evaluationId: ev.id });
});
