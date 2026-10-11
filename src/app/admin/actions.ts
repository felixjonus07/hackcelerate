"use server";
/** Staff server actions. Each re-authorizes in the data access layer. */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/server/audit/log";
import { APPROVER_ROLES } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { COUNSELING_COLUMNS } from "@/server/db/schema/enums";
import { decide } from "@/server/services/approvals";
import { moveCard } from "@/server/services/counseling";
import { runEvaluation } from "@/server/services/evaluations";

const decisionInput = z.object({
  interventionId: z.uuid(),
  decision: z.enum(["approve", "edit_approve", "reject"]),
  note: z.string().max(500).optional(),
  message: z.string().max(1000).optional(),
});

export async function decideIntervention(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser(APPROVER_ROLES);
  const parsed = decisionInput.safeParse({
    interventionId: form.get("interventionId"),
    decision: form.get("decision"),
    note: form.get("note") || undefined,
    message: form.get("message") || undefined,
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Something in the form is missing. Reload and try again.",
    };
  const d = parsed.data;
  try {
    await decide(d.interventionId, user, d.decision, d.note ?? null, d.message ?? null);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Couldn't save the decision",
    };
  }
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: `intervention.${d.decision}`,
    entityType: "intervention",
    entityId: d.interventionId,
    purpose: "approval_decision",
    sourceIp: (await headers()).get("x-forwarded-for"),
    result: "allowed",
  });
  revalidatePath("/admin/approvals");
  return {
    ok: true,
    message:
      d.decision === "reject"
        ? "Rejected. The reason is saved with the record."
        : "Approved. It's now in the dispatch queue.",
  };
}

export async function moveCounselingCard(input: {
  cardId: string;
  to: (typeof COUNSELING_COLUMNS)[number];
  reason?: string;
}) {
  const user = await requireUser(["faculty_mentor"]);
  const to = z.enum(COUNSELING_COLUMNS).parse(input.to);
  try {
    await moveCard(input.cardId, user.id, to, input.reason ?? null);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Move failed",
    };
  }
  revalidatePath("/admin/counseling-kanban");
  return { ok: true, message: "Moved" };
}

export async function runEval(studentId: string) {
  const user = await requireUser(["faculty_mentor", "registrar"]);
  await runEvaluation(z.uuid().parse(studentId), { actorUserId: user.id });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "evaluation.run",
    entityType: "student",
    entityId: studentId,
    purpose: "run_eval",
    result: "allowed",
  });
  revalidatePath("/admin", "layout");
}
