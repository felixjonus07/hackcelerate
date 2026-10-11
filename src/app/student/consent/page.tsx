import { eq } from "drizzle-orm";
import { Eye } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsentCenter } from "@/components/consent/consent-center";
import { NotificationPreferences } from "@/components/consent/notification-preferences";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { dateTime, shortDate } from "@/lib/format";
import { ROLE_LABELS } from "@/server/auth/roles";
import { requireStudent } from "@/server/auth/session";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "@/server/consent/matrix";
import { db } from "@/server/db";
import { leaderboardOptIns, notificationPreferences } from "@/server/db/schema";
import { currentConsents } from "@/server/services/consent";
import { accessLogFor, requestsFor } from "@/server/services/rights";

export const metadata: Metadata = { title: "Sharing" };

const ACTION_WORDS: Record<string, string> = {
  "passport.view": "opened your passport",
  "student_record.view": "opened your record",
  "evaluation.run": "ran an evaluation",
};

async function Consents() {
  const { student, user } = await requireStudent();
  const [state, [lb], requests, log, prefs] = await Promise.all([
    currentConsents(student.id),
    db.select().from(leaderboardOptIns).where(eq(leaderboardOptIns.studentId, student.id)).limit(1),
    requestsFor(student.id),
    accessLogFor(student, 15),
    db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, user.id)),
  ]);
  const email = prefs.find((p) => p.channel === "email");
  const wa = prefs.find((p) => p.channel === "whatsapp");
  return (
    <div className="grid gap-5">
      <ConsentCenter
        state={state}
        categories={CONSENTABLE as Record<string, string>}
        recipients={[...CONSENT_RECIPIENTS]}
        leaderboard={lb?.optedIn ?? false}
        requests={requests.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          createdOn: shortDate(r.createdAt),
          dueOn: r.dueAt ? shortDate(r.dueAt) : null,
          resolution: r.resolution,
        }))}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <NotificationPreferences
          email={email ? email.optedIn : true}
          whatsapp={wa?.optedIn ?? false}
          phone={wa?.destination ?? null}
        />
        <Card>
          <CardHeader
            title="Who has looked at your record"
            hint="Every time someone other than you opens it, it is written here."
          />
          {log.length ? (
            <ul className="divide-y divide-line">
              {log.map((e) => (
                <li key={`${e.at.toISOString()}-${e.action}-${e.role}`} className="flex gap-3 py-3 text-[0.95rem]">
                  <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
                  <span>
                    {ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] ?? e.role}{" "}
                    {ACTION_WORDS[e.action] ?? "viewed part of your record"}
                    <span className="block text-sm text-ink-2">
                      {dateTime(e.at)}
                      {e.purpose ? ` · ${e.purpose.replaceAll("_", " ")}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No one but you has opened your record yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <>
      <PageHeader
        title="Who sees what"
        description="Your assigned mentor always sees your record, because mentoring is part of your academic relationship. Everyone else sees only what you switch on here, and you can switch it off at any time."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Consents />
      </Suspense>
    </>
  );
}
