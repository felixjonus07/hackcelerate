import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth/session";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "@/server/consent/matrix";
import { db } from "@/server/db";
import { aspirations, students } from "@/server/db/schema";
import { getActivePolicy } from "@/server/policy/load";
import { currentConsents } from "@/server/services/consent";
import { onboardingState } from "@/server/services/onboarding";

export const metadata: Metadata = { title: "Set up your passport" };

async function Wizard() {
  const user = await requireUser(["student"]);
  const [student] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
  const [asp] = student
    ? await db
        .select()
        .from(aspirations)
        .where(and(eq(aspirations.studentId, student.id), eq(aspirations.isCurrent, true)))
        .orderBy(desc(aspirations.createdAt))
        .limit(1)
    : [];
  const policy = await getActivePolicy();
  const [state, consent] = student
    ? await Promise.all([onboardingState(student.id), currentConsents(student.id)])
    : [null, {}];
  return (
    <OnboardingWizard
      startStep={state?.onboardedAt ? 0 : (state?.step ?? 0)}
      noticeAcknowledged={state?.noticeAcknowledged ?? false}
      noticeVersion={policy.notice.version}
      consent={consent}
      categories={CONSENTABLE as Record<string, string>}
      recipients={[...CONSENT_RECIPIENTS]}
      evidenceCount={state?.evidenceCount ?? 0}
      hasEvaluation={state?.hasEvaluation ?? false}
      baseline={
        student
          ? {
              cgpa: student.cgpa,
              attendance: student.attendancePct,
              year: student.year,
              department: policy.department_standards[student.departmentCode]?.name ?? student.departmentCode,
              importedOn: student.erpImportedAt ? student.erpImportedAt.toISOString().slice(0, 10) : null,
            }
          : null
      }
      aspiration={
        asp
          ? {
              track: asp.track,
              targetOutcome: asp.targetOutcome,
              targetDate: asp.targetDate,
              readiness: asp.readiness,
            }
          : null
      }
      tracks={Object.entries(policy.tracks).map(([id, t]) => ({
        id,
        name: t.name,
      }))}
      readinessDefault={policy.readiness_default}
    />
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Wizard />
    </Suspense>
  );
}
