"use server";
/**
 * Student sign-up. Open to signed-out visitors by design, so everything is enforced in the service: the switch
 * (SIGNUP_ENABLED), the per-address rate limit, the reserved demo domain and the audit trail. The role is never read
 * from the request.
 */
import { headers } from "next/headers";
import { z } from "zod";
import { env } from "@/server/env";
import { SignUpError, signUpStudent } from "@/server/services/signup";

const input = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  departmentCode: z.string().min(1).max(20),
  year: z.coerce.number().int().min(1).max(4),
});

export async function signUpAction(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const parsed = input.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
    departmentCode: form.get("department"),
    year: form.get("year"),
  });
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Check your details: your name, a valid email, your department and year, and a password of 12 or more characters.",
    };
  const h = await headers();
  const ip = h.get(env.TRUSTED_IP_HEADER)?.split(",")[0]?.trim() || null;
  try {
    await signUpStudent(parsed.data, { ip });
    return { ok: true, message: "Your account is ready." };
  } catch (e) {
    if (e instanceof SignUpError) return { ok: false, message: e.message };
    return { ok: false, message: "Sign-up didn't go through. Try again in a moment." };
  }
}
