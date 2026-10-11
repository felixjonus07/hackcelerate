import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireStudent } from "@/server/auth/session";
import { getPassport } from "@/server/services/passport";
import { PassportView } from "./passport-view";

export const metadata: Metadata = { title: "My passport" };

async function PassportContent() {
  const { student } = await requireStudent();
  const data = await getPassport(student.id);
  return <PassportView data={data} />;
}

export default function PassportPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PassportContent />
    </Suspense>
  );
}
