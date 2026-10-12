import type { Metadata } from "next";
import { Suspense } from "react";
import { Brand } from "@/components/shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { firstName } from "@/lib/format";
import { homeFor, ROLE_LABELS } from "@/server/auth/roles";
import { getCurrentUser } from "@/server/auth/session";
import { demoLoginEnabled, env, oidcEnabled, signUpEnabled } from "@/server/env";
import { SignInForm } from "./sign-in-form";
import { SignOutHere } from "./sign-out-here";

export const metadata: Metadata = { title: "Sign in" };

const DEMO = [
  { email: "student@aspiredge.example", role: "Student", note: "Arjun · Mechanical" },
  { email: "mentor@aspiredge.example", role: "Faculty mentor", note: "Approvals, counseling board" },
  { email: "advisor@aspiredge.example", role: "Class advisor", note: "Attendance routes" },
  { email: "placement@aspiredge.example", role: "Placement officer", note: "Consented fields only" },
  { email: "dean@aspiredge.example", role: "Dean", note: "Command Center, audit" },
];

const REASONS = ["idle", "expired", "signed_out", "revoked"] as const;
type Reason = (typeof REASONS)[number];

async function Panel({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const [{ reason, next }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (user) {
    return (
      <div>
        <h2 className="text-xl font-extrabold">You're already signed in</h2>
        <p className="mt-2 text-ink-2">
          Signed in as <strong className="text-ink">{firstName(user.name)}</strong> ({ROLE_LABELS[user.role]}).
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink href={next?.startsWith("/") && !next.startsWith("//") ? next : homeFor(user.role)}>
            Continue
          </ButtonLink>
          <SignOutHere />
        </div>
      </div>
    );
  }
  return (
    <SignInForm
      reason={REASONS.includes(reason as Reason) ? (reason as Reason) : null}
      demo={demoLoginEnabled ? DEMO : []}
      oidc={oidcEnabled ? env.OIDC_PROVIDER_ID : null}
      signUp={signUpEnabled}
      policy={{
        staffIdleMinutes: env.SESSION_STAFF_IDLE_MINUTES,
        studentIdleMinutes: env.SESSION_STUDENT_IDLE_MINUTES,
        trustedDays: env.SESSION_STUDENT_TRUSTED_DAYS,
      }}
    />
  );
}

export default function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[1100px] content-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
      <div className="flex flex-col justify-center">
        <div className="-ml-3 mb-10">
          <Brand />
        </div>
        <h1 className="max-w-[16ch] text-[2.4rem] font-black leading-[1.08] tracking-tight sm:text-[2.9rem]">
          Verified evidence, a clear gap, one next step.
        </h1>
        <p className="mt-4 max-w-[48ch] text-lg text-ink-2">
          Students see where they stand and who can see their data. Mentors see who needs attention and why, and approve
          every step before it happens.
        </p>
        <p className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-sand-2 px-3 py-1.5 text-sm font-bold text-ink-2">
          Demo institution · every record is synthetic
        </p>
      </div>
      <div className="self-center rounded-card bg-card p-6 shadow-card sm:p-8">
        <Suspense
          fallback={
            <div aria-hidden className="grid gap-3">
              <Skeleton className="h-7 w-1/3" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          }
        >
          <Panel searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
