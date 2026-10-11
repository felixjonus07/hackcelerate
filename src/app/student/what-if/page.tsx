import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { PageSkeleton } from "@/components/ui/skeleton";
import { WhatIfSimulator } from "@/components/what-if/simulator";
import { requireStudent } from "@/server/auth/session";
import { getWhatIfInputs } from "@/server/services/passport";

export const metadata: Metadata = { title: "What-if" };

async function Simulator() {
  const { student } = await requireStudent();
  const { facts, policy } = await getWhatIfInputs(student.id);
  return <WhatIfSimulator facts={facts} policy={policy} />;
}

export default function WhatIfPage() {
  return (
    <>
      <PageHeader
        title="What if…"
        description="Move a lever to see exactly what your score would be with that evidence in place. Nothing here is saved."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Simulator />
      </Suspense>
    </>
  );
}
