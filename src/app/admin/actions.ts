"use server";
/** Staff server actions. Each re-authorizes in the data access layer. */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/server/audit/log";
import { APPROVER_ROLES } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { COUNSELING_COLUMNS, ROLES } from "@/server/db/schema/enums";
import { decide } from "@/server/services/approvals";
import { moveCard } from "@/server/services/counseling";
import { runEvaluation } from "@/server/services/evaluations";
import { approveVersion, createDraft, PolicyError } from "@/server/services/policy-admin";
import { ErasureError, executeErasure } from "@/server/services/retention";
import { RightsError, resolveRequest } from "@/server/services/rights";
import { changeRole, createStaffUser, setDisabled, signOutEverywhere, UserAdminError } from "@/server/services/users";
import {
  confirmInternship,
  ReviewError,
  resolveFlag,
  reviewArtifact,
  reviewSampledMock,
} from "@/server/verification/review";

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
  let dispatch: Awaited<ReturnType<typeof decide>>["dispatch"] = null;
  try {
    const r = await decide(d.interventionId, user, d.decision, d.note ?? null, d.message ?? null);
    dispatch = r.dispatch;
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
        : dispatch?.status === "BLOCKED"
          ? `Approved, but not sent. ${dispatch.message}`
          : "Approved and sent.",
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

const reviewInput = z.object({
  kind: z.enum(["artifact", "internship", "mock", "flag"]),
  id: z.uuid(),
  decision: z.enum(["attest", "reject", "MATCH", "MISMATCH", "resolve"]),
  reason: z.string().max(500),
});

/** One decision on one waiting item (§6.2). The reviewer is the signed-in person; the reason is stored with the record. */
export async function reviewItem(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser(APPROVER_ROLES);
  const parsed = reviewInput.safeParse({
    kind: form.get("kind"),
    id: form.get("id"),
    decision: form.get("decision"),
    reason: String(form.get("reason") ?? ""),
  });
  if (!parsed.success) return { ok: false, message: "Something in the form is missing. Reload and try again." };
  const d = parsed.data;
  const ip = (await headers()).get("x-forwarded-for");
  try {
    if (d.kind === "artifact" && (d.decision === "attest" || d.decision === "reject"))
      await reviewArtifact(user, d.id, d.decision, d.reason, ip);
    else if (d.kind === "internship" && (d.decision === "attest" || d.decision === "reject"))
      await confirmInternship(user, d.id, d.decision, d.reason);
    else if (d.kind === "mock" && (d.decision === "MATCH" || d.decision === "MISMATCH"))
      await reviewSampledMock(user, d.id, d.decision, d.reason);
    else if (d.kind === "flag" && d.decision === "resolve") await resolveFlag(user, d.id, d.reason);
    else return { ok: false, message: "That decision doesn't fit this item." };
  } catch (e) {
    if (e instanceof ReviewError) return { ok: false, message: e.message };
    if (e instanceof Error) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/admin/evidence");
  return { ok: true, message: "Recorded." };
}

// ── Registrar and policy (§3.3, §13.7) ───────────────────────────────────────────────────

export async function createPolicyDraft(
  _: unknown,
  form: FormData,
): Promise<{ ok: boolean; message: string; issues?: string[] }> {
  const user = await requireUser(["registrar"]);
  let doc: unknown;
  try {
    doc = JSON.parse(String(form.get("document") ?? ""));
  } catch {
    return { ok: false, message: "The text is not valid JSON.", issues: [] };
  }
  try {
    const d = await createDraft(user, doc, (await headers()).get("x-forwarded-for"));
    revalidatePath("/admin/policy");
    return {
      ok: true,
      message: `Draft ${d.version} saved. It needs ${d.approvalsRequired} ${d.approvalsRequired === 1 ? "approval" : "approvals"}${d.changedSections.length ? ` (changed: ${d.changedSections.join(", ")})` : ""}.`,
    };
  } catch (e) {
    if (e instanceof z.ZodError)
      return {
        ok: false,
        message: "The policy does not pass validation.",
        issues: e.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      };
    if (e instanceof PolicyError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function approvePolicy(version: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser(["registrar", "dean"]);
  try {
    const r = await approveVersion(
      user,
      z.string().min(1).max(40).parse(version),
      (await headers()).get("x-forwarded-for"),
    );
    revalidatePath("/admin/policy");
    return {
      ok: true,
      message:
        r.status === "ACTIVE"
          ? "Approved and now in force. Affected students are queued for re-evaluation."
          : `Approved (${r.approvals} of ${r.required}). Waiting for the other approver.`,
    };
  } catch (e) {
    if (e instanceof PolicyError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function resolveRightsRequest(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser(["registrar", "faculty_mentor"]);
  const input = z
    .object({
      id: z.uuid(),
      outcome: z.string().max(1000),
      erase: z.string().optional(),
    })
    .safeParse({
      id: form.get("id"),
      outcome: String(form.get("outcome") ?? ""),
      erase: form.get("erase") ?? undefined,
    });
  if (!input.success) return { ok: false, message: input.error.issues[0]?.message ?? "Check the form." };
  try {
    if (input.data.erase === "yes") await executeErasure(user, input.data.id);
    else await resolveRequest(user, input.data.id, input.data.outcome);
  } catch (e) {
    if (e instanceof RightsError || e instanceof ErasureError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/admin/requests");
  return { ok: true, message: "Closed. The student has been told." };
}

// ── User management (registrar only). The service re-checks the role and audits every change. ──

type UserResult = { ok: boolean; message: string };

async function userAdmin(
  run: (actor: Awaited<ReturnType<typeof requireUser>>) => Promise<string>,
): Promise<UserResult> {
  const actor = await requireUser(["registrar"]);
  try {
    const message = await run(actor);
    revalidatePath("/admin/users");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof UserAdminError) return { ok: false, message: e.message };
    throw e;
  }
}

const staffInput = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(254),
  role: z.enum(ROLES),
  password: z.string().min(12).max(128),
});

export async function addStaffUser(_: unknown, form: FormData): Promise<UserResult> {
  const parsed = staffInput.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    role: form.get("role"),
    password: form.get("password"),
  });
  if (!parsed.success)
    return { ok: false, message: "Check the name, a valid email, a role, and a password of 12 or more characters." };
  return userAdmin(async (actor) => {
    await createStaffUser(actor, parsed.data);
    return `Added ${parsed.data.name}. Share the password with them securely; they can change it in their account.`;
  });
}

const idInput = z.object({ id: z.string().min(1).max(64) });

export async function changeUserRole(_: unknown, form: FormData): Promise<UserResult> {
  const parsed = idInput.extend({ role: z.enum(ROLES) }).safeParse({ id: form.get("id"), role: form.get("role") });
  if (!parsed.success) return { ok: false, message: "Choose a role first." };
  return userAdmin(async (actor) => {
    await changeRole(actor, parsed.data.id, parsed.data.role);
    return "Role updated. They were signed out and will get the new access when they sign in again.";
  });
}

export async function toggleUserAccount(_: unknown, form: FormData): Promise<UserResult> {
  const parsed = idInput.extend({ off: z.enum(["yes", "no"]) }).safeParse({ id: form.get("id"), off: form.get("off") });
  if (!parsed.success) return { ok: false, message: "Reload the page and try again." };
  const off = parsed.data.off === "yes";
  return userAdmin(async (actor) => {
    await setDisabled(actor, parsed.data.id, off);
    return off ? "Account turned off and signed out everywhere." : "Account turned back on.";
  });
}

export async function signOutUserEverywhere(_: unknown, form: FormData): Promise<UserResult> {
  const parsed = idInput.safeParse({ id: form.get("id") });
  if (!parsed.success) return { ok: false, message: "Reload the page and try again." };
  return userAdmin(async (actor) => {
    const n = await signOutEverywhere(actor, parsed.data.id);
    return n ? `Signed out of ${n} session${n === 1 ? "" : "s"}.` : "They had no open sessions.";
  });
}
