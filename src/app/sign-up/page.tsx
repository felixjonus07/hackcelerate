import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Brand } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { homeFor } from "@/server/auth/roles";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { departments } from "@/server/db/schema";
import { signUpEnabled } from "@/server/env";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

async function Panel() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  if (!signUpEnabled)
    return (
      <EmptyState
        title="Sign-up is closed right now"
        action={
          <Link href="/sign-in" className="font-bold text-act hover:underline">
            Go to sign in
          </Link>
        }
      >
        Ask your institution to create your account, then sign in with the email and password they give you.
      </EmptyState>
    );
  const rows = await db
    .select({ code: departments.code, name: departments.name })
    .from(departments)
    .orderBy(asc(departments.name));
  return <SignUpForm departments={rows} />;
}

export default function SignUpPage() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[1100px] content-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
      <div className="flex flex-col justify-center">
        <div className="-ml-3 mb-10">
          <Brand />
        </div>
        <h1 className="max-w-[16ch] text-[2.4rem] font-black leading-[1.08] tracking-tight sm:text-[2.9rem]">
          Your passport starts with a few details.
        </h1>
        <p className="mt-4 max-w-[48ch] text-pretty text-lg text-ink-2">
          After you create your account you read a short notice and choose who can see your data. Nothing is shared
          until you say so.
        </p>
      </div>
      <div className="self-center rounded-card bg-card p-6 shadow-card sm:p-8">
        <Suspense
          fallback={
            <div aria-hidden className="grid gap-3">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          }
        >
          <Panel />
        </Suspense>
      </div>
    </main>
  );
}
