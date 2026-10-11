import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { db } from "@/server/db";
import { quests } from "@/server/db/schema";
import { EvidenceError, submitEvidence } from "@/server/services/evidence";

const body = z.object({
  sourceUrl: z.string().max(500).optional(),
  description: z.string().max(1000).optional(),
});

/**
 * POST /api/v1/quests/{id}/evidence — submit evidence for one of the student's own quests.
 * JSON `{ sourceUrl, description }` for a link, or multipart with a `file` for a certificate or letter.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user, student } = await meStudent();
  const { id } = await ctx.params;
  const [q] = await db
    .select()
    .from(quests)
    .where(and(eq(quests.id, z.uuid().parse(id)), eq(quests.studentId, student.id)))
    .limit(1);
  if (!q) return apiError(404, "not_found", "Quest not found");

  let b: z.infer<typeof body>;
  let file: { bytes: Uint8Array; contentType: string } | null = null;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    b = body.parse({
      sourceUrl: form.get("sourceUrl") || undefined,
      description: form.get("description") || undefined,
    });
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = { bytes: new Uint8Array(await f.arrayBuffer()), contentType: f.type };
  } else {
    b = body.parse(await req.json());
  }
  try {
    const a = await submitEvidence(
      student,
      user,
      {
        type: q.requiredEvidenceType,
        label: q.title,
        component: q.componentKey ?? "general",
        standardItem: q.standardItem,
        sourceUrl: b.sourceUrl,
        description: b.description,
        file,
        questId: q.id,
      },
      req.headers.get("x-forwarded-for"),
    );
    return json({ ok: true, artifactId: a.id, status: a.status }, { status: 201 });
  } catch (e) {
    if (e instanceof EvidenceError) return apiError(422, "evidence_rejected", e.message);
    throw e;
  }
});
