import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { Suspense } from "react";
import { AppShell, PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { dateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { markNoticesRead, noticesFor } from "@/server/notifications";

export const metadata: Metadata = { title: "Notices" };

async function markAllRead() {
  "use server";
  const user = await requireUser();
  await markNoticesRead(user);
  revalidatePath("/notices");
}

async function Notices() {
  const user = await requireUser();
  const notices = await noticesFor(user, 40);
  if (!notices.length)
    return (
      <Card>
        <EmptyState title="Nothing new">Messages about approvals, deadlines and requests appear here.</EmptyState>
      </Card>
    );
  const unread = notices.filter((n) => !n.read).length;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">{unread ? `${unread} unread` : "All read"}</p>
        {unread ? (
          <form action={markAllRead}>
            <Button type="submit" variant="secondary" size="sm">
              Mark all as read
            </Button>
          </form>
        ) : null}
      </div>
      <ul className="divide-y divide-line">
        {notices.map((n) => (
          <li key={n.id} className="flex gap-3 py-3.5">
            <Bell aria-hidden className="mt-1 size-4 shrink-0 text-ink-2" />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-extrabold">
                {n.title}
                {n.read ? null : <Tag kind="neutral">New</Tag>}
              </p>
              <p className="text-[0.95rem]">{n.body}</p>
              <p className="text-sm text-ink-2">{dateTime(n.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function NoticesPage() {
  return (
    <AppShell area="auto">
      <PageHeader title="Notices" description="Everything the platform has told you, newest first." />
      <Suspense fallback={<PageSkeleton />}>
        <Notices />
      </Suspense>
    </AppShell>
  );
}
