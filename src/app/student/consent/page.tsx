import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsentCenter } from "@/components/consent/consent-center";
import { PageHeader } from "@/components/shell/app-shell";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireStudent } from "@/server/auth/session";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "@/server/consent/matrix";
import { db } from "@/server/db";
import { leaderboardOptIns } from "@/server/db/schema";
import { currentConsents } from "@/server/services/consent";
import { getStudentRightsRequests } from "@/server/services/rights";

export const metadata: Metadata = { title: "Sharing" };

async function Consents() {
  const { student } = await requireStudent();
  const [state, [lb], rights] = await Promise.all([
    currentConsents(student.id),
    db.select().from(leaderboardOptIns).where(eq(leaderboardOptIns.studentId, student.id)).limit(1),
    getStudentRightsRequests(student.id),
  ]);
  return (
    <ConsentCenter
      state={state}
      categories={CONSENTABLE as Record<string, string>}
      recipients={[...CONSENT_RECIPIENTS]}
      leaderboard={lb?.optedIn ?? false}
      rightsRequestsList={rights}
    />
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
