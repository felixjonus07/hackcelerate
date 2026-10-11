"use client";
/**
 * Sign-in form. No credentials live in this bundle: demo buttons only fill the
 * email, and the password is always typed. Errors never reveal whether an
 * account exists (§13.2). Lockout and rate-limit messages come from the server.
 */
import { Building2, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { homeFor } from "@/server/auth/roles";
import type { Role } from "@/server/db/schema/enums";

type Reason = "idle" | "expired" | "signed_out" | "revoked";

const REASON_TEXT: Record<Reason, string> = {
  idle: "You were signed out after a period without activity, to protect student data.",
  expired: "Your session reached its time limit. Please sign in again.",
  signed_out: "You've signed out.",
  revoked: "This session was signed out from another device.",
};

interface Props {
  reason: Reason | null;
  demo: { email: string; role: string; note: string }[];
  oidc: string | null;
  policy: { staffIdleMinutes: number; studentIdleMinutes: number; trustedDays: number };
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

const safeNext = (n: string | null) => (n?.startsWith("/") && !n.startsWith("//") ? n : null);

export function SignInForm({ reason, demo, oidc, policy }: Props) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A timed-out or revoked session can leave a stale cookie behind: clear it.
  useEffect(() => {
    if (reason) authClient.signOut().catch(() => undefined);
  }, [reason]);

  const pickDemo = (email: string) => {
    if (emailRef.current) emailRef.current.value = email;
    setError(null);
    passwordRef.current?.focus();
  };

  const onSubmit = (form: FormData) => {
    setError(null);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const rememberMe = form.get("remember") === "on";
    start(async () => {
      const { data, error: err } = await authClient.signIn.email({ email, password, rememberMe });
      if (err || !data) {
        if (passwordRef.current) passwordRef.current.value = "";
        if (err?.status === 429) setError(err.message || "Too many attempts. Wait a few minutes, then try again.");
        else if (err?.status === 401) setError("That email and password don't match. Check both and try again.");
        else setError("Sign-in didn't go through. Try again in a moment.");
        passwordRef.current?.focus();
        return;
      }
      const role = ((data.user as { role?: string }).role ?? "student") as Role;
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")) ?? homeFor(role));
    });
  };

  return (
    <div>
      <h2 className="text-xl font-extrabold">Sign in</h2>
      {reason ? (
        <output className="mt-4 flex gap-2 rounded-2xl bg-sand px-4 py-3 text-[0.95rem]">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
          {REASON_TEXT[reason]}
        </output>
      ) : null}

      {oidc ? (
        <Button
          variant="secondary"
          className="mt-5 w-full"
          onClick={() => authClient.signIn.social({ provider: oidc, callbackURL: "/sign-in" })}
        >
          <Building2 aria-hidden className="size-4" /> Continue with your institution account
        </Button>
      ) : null}

      {demo.length ? (
        <div className="mt-5">
          <p className="text-sm font-bold text-ink-2">Demo accounts: choose one, then enter the demo password</p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {demo.map((d) => (
              <li key={d.email}>
                <button
                  type="button"
                  onClick={() => pickDemo(d.email)}
                  className="press w-full rounded-2xl bg-sand px-3.5 py-2.5 text-left hover:bg-sand-2"
                >
                  <span className="block font-extrabold">{d.role}</span>
                  <span className="block truncate text-sm text-ink-2">{d.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={onSubmit} className="mt-6 grid gap-3 border-t border-line pt-6">
        <label className="grid gap-1.5 text-sm font-bold">
          Email
          <input
            ref={emailRef}
            name="email"
            type="email"
            required
            autoComplete="username"
            className="h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-bold">
          Password
          <input
            ref={passwordRef}
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="current-password"
            className="h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
          />
        </label>
        <label className="flex items-start gap-3 py-1 text-[0.95rem]">
          <input name="remember" type="checkbox" className="mt-1 size-4 shrink-0" />
          <span>
            Keep me signed in on this device for {policy.trustedDays} days
            <span className="block text-sm text-ink-2">
              Students only, and never on a shared computer. Without it you're signed out after{" "}
              {plural(policy.studentIdleMinutes, "minute")} of inactivity. Staff accounts are never remembered and sign
              out after {plural(policy.staffIdleMinutes, "minute")} of inactivity.
            </span>
          </span>
        </label>
        {error ? (
          <p role="alert" className="rounded-xl bg-crit-bg px-3 py-2 text-sm font-semibold text-crit">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="mt-1">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
