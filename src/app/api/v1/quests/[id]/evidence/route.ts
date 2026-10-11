import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { audit } from "@/server/audit/log";
import { db } from "@/server/db";
import { artifacts, quests } from "@/server/db/schema";
import { enqueue } from "@/server/queue";

const body = z.object({
  sourceUrl: z.url().max(500),
  description: z.string().max(1000).optional(),
});

/** POST /api/v1/quests/{id}/evidence — submit evidence for one of the student's own quests. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user, student } = await meStudent();
  const { id } = await ctx.params;
  const b = body.parse(await req.json());
  const [q] = await db
    .select()
    .from(quests)
    .where(and(eq(quests.id, z.uuid().parse(id)), eq(quests.studentId, student.id)))
    .limit(1);
  if (!q) return apiError(404, "not_found", "Quest not found");
  const [a] = await db
    .insert(artifacts)
    .values({
      studentId: student.id,
      type: q.requiredEvidenceType,
      component: q.componentKey ?? "general",
      standardItem: q.standardItem,
      label: q.title,
      description: b.description ?? null,
      sourceUrl: b.sourceUrl,
      source: "student",
      status: "SUBMITTED",
    })
    .returning();
  await db.update(quests).set({ status: "EVIDENCE_SUBMITTED", evidenceArtifactId: a.id }).where(eq(quests.id, q.id));
  await enqueue("verification", {
    artifactId: a.id,
    kind: /github\.com/.test(b.sourceUrl) ? "github" : /doi\.org/.test(b.sourceUrl) ? "crossref" : "link",
  }).catch(() => null);
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "artifact.submit",
    entityType: "artifact",
    entityId: a.id,
    purpose: "quest_evidence",
    result: "allowed",
  });
  return json({ ok: true, artifactId: a.id, status: a.status }, { status: 201 });
});
