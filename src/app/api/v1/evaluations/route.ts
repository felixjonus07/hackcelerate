import { z } from "zod";
import { rolesOf } from "@/server/api/access";
import { handle, json } from "@/server/api/handler";
import { audit } from "@/server/audit/log";
import { requireApiUser } from "@/server/auth/session";
import { runEvaluation } from "@/server/services/evaluations";

/** POST /api/v1/evaluations — run an evaluation for one student (assigned mentor, admin). */
export const POST = handle(async (req: Request) => {
  const user = await requireApiUser(rolesOf("evaluations"));
  const { studentId } = z.object({ studentId: z.uuid() }).parse(await req.json());
  const row = await runEvaluation(studentId, { actorUserId: user.id });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "evaluation.run",
    entityType: "student",
    entityId: studentId,
    purpose: "run_eval",
    result: "allowed",
  });
  return json(
    {
      id: row.id,
      trackScore: row.trackScore,
      aegIndex: row.aegIndex,
      fallback: row.fallback,
    },
    { status: 201 },
  );
});
