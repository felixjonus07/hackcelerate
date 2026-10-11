"use server";
/** Account security actions: session revocation and password change (§13.2). */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/server/audit/log";
import { auth } from "@/server/auth";
import { requireUser } from "@/server/auth/session";

export async function revokeSession(token: string) {
  const user = await requireUser();
  const h = await headers();
  const mine = await auth.api.listSessions({ headers: h });
  const target = mine.find((s) => s.token === token);
  if (!target) return; // only the caller's own sessions can be revoked
  await auth.api.revokeSession({ headers: h, body: { token } });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "session.revoke",
    entityType: "session",
    entityId: target.id,
    purpose: "account_security",
    result: "allowed",
  });
  revalidatePath("/account/security");
}

export async function revokeOtherSessions() {
  const user = await requireUser();
  await auth.api.revokeOtherSessions({ headers: await headers() });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "session.revoke_others",
    entityType: "user",
    entityId: user.id,
    purpose: "account_security",
    result: "allowed",
  });
  revalidatePath("/account/security");
}

const passwordInput = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(12, "Use at least 12 characters").max(128, "Use at most 128 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: "The new passwords don't match", path: ["confirm"] })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "Choose a password you haven't used here",
    path: ["newPassword"],
  });

export async function changePassword(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const parsed = passwordInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
    });
  } catch {
    await audit({
      actorUserId: user.id,
      actorRole: user.role,
      action: "password.change",
      entityType: "user",
      entityId: user.id,
      purpose: "account_security",
      result: "denied",
    });
    return { ok: false, message: "Your current password isn't right. Nothing was changed." };
  }
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "password.change",
    entityType: "user",
    entityId: user.id,
    purpose: "account_security",
    result: "allowed",
  });
  revalidatePath("/account/security");
  return { ok: true, message: "Password changed. Every other device has been signed out." };
}
