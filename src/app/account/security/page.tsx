import { Laptop, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { AppShell, PageHeader } from "@/components/shell/app-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { dateTime } from "@/lib/format";
import { auth } from "@/server/auth";
import { getSessionTiming, requireUser } from "@/server/auth/session";
import { revokeOtherSessions, revokeSession } from "../actions";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Account security" };

/** Rough, dependency-free device label from a user-agent string. */
function deviceLabel(ua: string | null | undefined): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

const human = (seconds: number) =>
  seconds >= 86_400
    ? `${Math.round(seconds / 86_400)} days`
    : seconds >= 3_600
      ? `${Math.round(seconds / 3_600)} hours`
      : `${Math.round(seconds / 60)} minutes`;

async function Security() {
  await requireUser();
  const [sessions, timing] = await Promise.all([
    auth.api.listSessions({ headers: await headers() }),
    getSessionTiming(),
  ]);
  const active = sessions.filter((s) => new Date(s.expiresAt) > new Date());
  const current = active.find((s) => s.id === timing?.sessionId);
  const others = active.filter((s) => s.id !== timing?.sessionId);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="This session" hint="How long you stay signed in on this device" />
        {current && timing ? (
          <dl className="grid gap-3 text-[0.95rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Device</dt>
              <dd className="text-right font-semibold">{deviceLabel(current.userAgent).label}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Signed in</dt>
              <dd className="text-right font-semibold">{dateTime(current.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Signs out after no activity for</dt>
              <dd className="text-right font-semibold">{human(timing.idleSeconds)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Ends at the latest</dt>
              <dd className="text-right font-semibold">{dateTime(timing.expiresAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">This device</dt>
              <dd>{timing.trusted ? <Tag kind="low">Trusted</Tag> : <Tag>Not remembered</Tag>}</dd>
            </div>
          </dl>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Other devices"
          hint={
            others.length
              ? `${others.length} other active session${others.length === 1 ? "" : "s"}`
              : "You're not signed in anywhere else"
          }
          action={
            others.length ? (
              <form action={revokeOtherSessions}>
                <button
                  type="submit"
                  className="press inline-flex h-9 items-center rounded-full bg-card px-4 text-sm font-bold text-crit ring-1 ring-inset ring-line hover:bg-crit-bg"
                >
                  Sign out everywhere else
                </button>
              </form>
            ) : null
          }
        />
        {others.length ? (
          <ul className="divide-y divide-line">
            {others.map((s) => {
              const d = deviceLabel(s.userAgent);
              const Icon = d.mobile ? Smartphone : Laptop;
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-start gap-3">
                    <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
                    <span className="min-w-0">
                      <span className="block font-semibold">{d.label}</span>
                      <span className="block text-sm text-ink-2">Signed in {dateTime(s.createdAt)}</span>
                    </span>
                  </span>
                  <form action={revokeSession.bind(null, s.token)}>
                    <button
                      type="submit"
                      className="press inline-flex h-9 items-center rounded-full bg-sand-2 px-4 text-sm font-bold hover:bg-sand-3"
                    >
                      Sign out
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-2xl bg-sand px-4 py-3 text-sm text-ink-2">
            If you sign in on another device, it will appear here so you can sign it out.
          </p>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Change password" hint="At least 12 characters. Changing it signs out every other device." />
        <PasswordForm />
      </Card>
    </div>
  );
}

export default function SecurityPage() {
  return (
    <AppShell area="auto">
      <PageHeader
        title="Account security"
        description="Where you're signed in, how long sessions last, and your password."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Security />
      </Suspense>
    </AppShell>
  );
}
