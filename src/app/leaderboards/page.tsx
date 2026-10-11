import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, PageHeader } from "@/components/shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Leaderboards" };

// Phase 7: tabs per track, streak badges and verified-link chips for opted-in students only.
async function Boards() {
  const user = await requireUser();
  return (
    <Card>
      <EmptyState
        title="No opt-ins yet"
        action={
          user.role === "student" ? <ButtonLink href="/student/consent">Join from Sharing</ButtonLink> : undefined
        }
      >
        Leaderboards show only students who chose to join. Joining is off by default and can be reversed at any time.
      </EmptyState>
    </Card>
  );
}

export default function LeaderboardsPage() {
  return (
    <AppShell area="auto">
      <PageHeader title="Leaderboards" />
      <Suspense fallback={<PageSkeleton />}>
        <Boards />
      </Suspense>
    </AppShell>
  );
}
