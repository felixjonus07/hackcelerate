import { Ban, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { AddStaffForm, UserActions } from "@/components/staff/user-admin";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { shortDate } from "@/lib/format";
import { ROLE_LABELS, STAFF_ROLES } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { ROLES, type Role } from "@/server/db/schema/enums";
import { listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Users" };

const staffOptions = STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const field = "h-11 rounded-field border border-line bg-card px-3 text-base font-normal";

type Search = { q?: string; role?: string; status?: string; page?: string };

function pageHref(sp: Search, page: number) {
  const p = new URLSearchParams();
  if (sp.q) p.set("q", sp.q);
  if (sp.role) p.set("role", sp.role);
  if (sp.status) p.set("status", sp.status);
  p.set("page", String(page));
  return `/admin/users?${p}`;
}

async function Users({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser(["registrar"]);
  const sp = await searchParams;
  const role = (ROLES as readonly string[]).includes(sp.role ?? "") ? (sp.role as Role) : undefined;
  const status = sp.status === "active" || sp.status === "off" ? sp.status : undefined;
  const { rows, total, page, pages } = await listUsers(me, {
    q: sp.q,
    role,
    status,
    page: Number(sp.page) || 1,
  });
  const filtered = Boolean(sp.q || role || status);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Add a staff member"
          hint="They sign in with the email and first password you set here. Students create their own accounts on the sign-up page."
        />
        <AddStaffForm roles={staffOptions} />
      </Card>

      <Card>
        <CardHeader title="People" hint={`${total} account${total === 1 ? "" : "s"}${filtered ? " match" : ""}`} />
        <form action="/admin/users" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
          <label className="grid gap-1.5 text-sm font-bold">
            Search by name or email
            <input name="q" type="search" defaultValue={sp.q ?? ""} maxLength={80} className={field} />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Role
            <select name="role" defaultValue={role ?? ""} className={field}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Status
            <select name="status" defaultValue={status ?? ""} className={field}>
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="off">Turned off</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>

        {rows.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title={filtered ? "No one matches those filters" : "No accounts yet"}
              action={
                filtered ? (
                  <ButtonLink href="/admin/users" variant="secondary" size="sm">
                    Clear filters
                  </ButtonLink>
                ) : undefined
              }
            >
              {filtered ? "Try a shorter search or another role." : "Accounts appear here as people sign up."}
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-line border-t border-line">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold">{r.name}</span>
                    {r.id === me.id ? <Tag>You</Tag> : null}
                    <Tag>{ROLE_LABELS[r.role]}</Tag>
                    {r.off ? (
                      <Tag kind="mod" icon={<Ban aria-hidden className="size-3.5" />}>
                        Turned off
                      </Tag>
                    ) : (
                      <Tag kind="low" icon={<CircleCheck aria-hidden className="size-3.5" />}>
                        Active
                      </Tag>
                    )}
                  </div>
                  <p className="mt-0.5 break-words text-sm text-ink-2">
                    {r.email} · joined {shortDate(r.createdAt)}
                  </p>
                </div>
                {r.id === me.id ? (
                  <p className="text-sm text-ink-2 lg:text-right">This is your account.</p>
                ) : (
                  <UserActions id={r.id} role={r.role} off={r.off} isStudent={r.isStudent} roles={staffOptions} />
                )}
              </li>
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <nav
            aria-label="Pages"
            className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
          >
            <span className="text-sm text-ink-2">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <ButtonLink href={pageHref(sp, page - 1)} variant="secondary" size="sm">
                  Previous
                </ButtonLink>
              ) : null}
              {page < pages ? (
                <ButtonLink href={pageHref(sp, page + 1)} variant="secondary" size="sm">
                  Next
                </ButtonLink>
              ) : null}
            </div>
          </nav>
        ) : null}
      </Card>
    </div>
  );
}

export default function UsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <>
      <PageHeader
        title="Users"
        description="Add staff, change roles and turn accounts on or off. Every change is recorded in the audit log."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Users searchParams={searchParams} />
      </Suspense>
    </>
  );
}
