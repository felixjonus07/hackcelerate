import { eq } from "drizzle-orm";
import { handle, json } from "@/server/api/handler";
import { audit } from "@/server/audit/log";
import { requireApiUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { students } from "@/server/db/schema";
import { getPassport } from "@/server/services/passport";

/** GET /api/v1/students/me/passport — latest evaluation, gap index, trend, breakdown (student only). */
export const GET = handle(async () => {
  const user = await requireApiUser(["student"]);
  const [s] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
  if (!s) return json({ error: { code: "not_onboarded", message: "Finish onboarding first" } }, { status: 404 });
  const p = await getPassport(s.id);
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "passport.view",
    entityType: "student",
    entityId: s.pseudonymousId,
    purpose: "self_access",
    result: "allowed",
  });
  const ev = p.evaluation;
  return json({
    student: s.pseudonymousId,
    policyVersion: p.policyVersion,
    evaluation: ev && {
      id: ev.id,
      track: ev.track,
      trackScore: ev.trackScore,
      readiness: ev.readiness,
      gapIndex: ev.aegIndex,
      trend: ev.trend,
      confidence: ev.confidence,
      components: ev.result.trackScore.components,
      dataGaps: ev.result.trackScore.dataGaps,
      narrative: ev.narrative,
      fallback: ev.fallback,
      createdAt: ev.createdAt,
    },
    quests: p.quests,
    evidence: p.evidence.map((e) => ({
      id: e.id,
      label: e.label,
      status: e.status,
    })),
  });
});
