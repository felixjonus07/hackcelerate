"use client";
/**
 * Student sign-up form. After the account is made it signs the student in with the same details, so they land on
 * the onboarding notice without a second form. Errors never say whether an email is already registered.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { signUpAction } from "./actions";

const YEARS = [
  { value: 1, label: "First year" },
  { value: 2, label: "Second year" },
  { value: 3, label: "Third year" },
  { value: 4, label: "Fourth year" },
];

const field = "h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal";

export function SignUpForm({ departments }: { departments: { code: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (form: FormData) => {
    setError(null);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    start(async () => {
      const result = await signUpAction(null, form);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const { error: signInError } = await authClient.signIn.email({ email, password, rememberMe: false });
      // The account exists either way; if the automatic sign-in fails, the sign-in page is one step away.
      router.replace(signInError ? "/sign-in" : "/student/onboarding");
    });
  };

  return (
    <div>
      <h2 className="text-xl font-extrabold">Create your student account</h2>
      <p className="mt-1 text-ink-2">It takes a minute. Staff accounts are set up by the registrar.</p>
      <form action={onSubmit} className="mt-6 grid gap-3">
        <label className="grid gap-1.5 text-sm font-bold">
          Full name
          <input name="name" required minLength={2} maxLength={80} autoComplete="name" className={field} />
        </label>
        <label className="grid gap-1.5 text-sm font-bold">
          Email
          <input name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <label className="grid gap-1.5 text-sm font-bold">
            Department
            <select name="department" required defaultValue="" className={field}>
              <option value="" disabled>
                Choose your department
              </option>
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Year of study
            <select name="year" required defaultValue="" className={field}>
              <option value="" disabled>
                Choose a year
              </option>
              {YEARS.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-bold">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            aria-describedby="password-hint"
            className={field}
          />
          <span id="password-hint" className="text-sm font-normal text-ink-2">
            At least 12 characters. A few unrelated words is easy to remember and hard to guess.
          </span>
        </label>
        {error ? (
          <p role="alert" className="rounded-xl bg-crit-bg px-3 py-2 text-sm font-semibold text-crit">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="mt-1">
          {pending ? "Creating your account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 border-t border-line pt-5 text-[0.95rem] text-ink-2">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-bold text-act hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
