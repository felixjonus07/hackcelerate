import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { aspirations, students } from "@/server/db/schema";
import { getActivePolicy } from "@/server/policy/load";

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
  const policy = getActivePolicy();
  return (
    <OnboardingWizard
      baseline={
        student
          ? {
              cgpa: student.cgpa,
              attendance: student.attendancePct,
              year: student.year,
              department: policy.department_standards[student.departmentCode]?.name ?? student.departmentCode,
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
