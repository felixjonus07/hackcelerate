import type { Metadata } from "next";
import { Suspense } from "react";
import { ShadowHold } from "@/components/shell/shadow-hold";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireStudent } from "@/server/auth/session";
import { getPassport } from "@/server/services/passport";
import { mayViewOutputs } from "@/server/shadow";
import { PassportView } from "./passport-view";

export const metadata: Metadata = { title: "My passport" };

async function PassportContent() {
  const { student, user } = await requireStudent();
  if (!mayViewOutputs(user)) return <ShadowHold />;
  const data = await getPassport(student.id, user);
  return <PassportView data={data} />;
}

export default function PassportPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PassportContent />
    </Suspense>
  );
}
