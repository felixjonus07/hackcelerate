import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { KanbanBoard } from "@/components/staff/kanban-board";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth/session";
import { board } from "@/server/services/counseling";

export const metadata: Metadata = { title: "Counseling board" };

async function Board() {
  const user = await requireUser(["faculty_mentor"]);
  const b = await board(user.id);
  return (
    <KanbanBoard
      wipLimit={b.wipLimit}
      openCount={b.openCount}
      columns={b.columns.map((c) => ({
        column: c.column,
        cards: c.cards.map((k) => ({
          id: k.id,
          studentId: k.studentId,
          pseudonymousId: k.pseudonymousId,
          departmentCode: k.departmentCode,
          nextDate: k.nextDate?.toISOString() ?? null,
          stale: k.stale,
          quests: k.quests,
        })),
      }))}
    />
  );
}

export default function KanbanPage() {
  return (
    <>
      <PageHeader
        title="Counseling board"
        description="One card per student with a route in progress. Drag a card, or focus it and use the move menu. Moving a card back asks for a reason."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Board />
      </Suspense>
    </>
  );
}
