/**
 * App shell: sand side nav on desktop, persistent bottom bar on phones.
 * The nav needs the session, so it streams in behind <Suspense>; the rest of
 * the shell is static and prerenders (Cache Components).
 */
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { firstName } from "@/lib/format";
import { ROLE_LABELS } from "@/server/auth/roles";
import { getCurrentUser, getSessionTiming } from "@/server/auth/session";
import { AccountLink } from "./account-link";
import { type NavItem, STUDENT_NAV, staffNav } from "./nav-config";
import { NavLink } from "./nav-link";
import { SessionGuard } from "./session-guard";
import { SignOutButton } from "./sign-out-button";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3 text-[1.35rem] font-black tracking-tight">
      <svg aria-hidden viewBox="0 0 28 28" className="size-7">
        <title>AspirEdge</title>
        <rect width="28" height="28" rx="9" className="fill-ink" />
        <path
          d="M8 19.5 14 7l6 12.5"
          fill="none"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-sand"
        />
        <circle cx="14" cy="19.5" r="2.2" className="fill-act-bright" />
      </svg>
      AspirEdge
    </Link>
  );
}

type Area = "student" | "staff" | "auto";

async function navFor(area: Area): Promise<{
  items: NavItem[];
  name: string;
  role: string;
  student: boolean;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const student = area === "student" || (area === "auto" && user.role === "student");
  return {
    items: student ? STUDENT_NAV : staffNav(user.role),
    name: user.name,
    role: ROLE_LABELS[user.role],
    student,
  };
}

async function SideNav({ area }: { area: Area }) {
  const nav = await navFor(area);
  if (!nav) return null;
  return (
    <>
      <nav aria-label="Main" className="flex flex-col gap-1.5">
        {nav.items.map((i) => (
          <NavLink key={i.href} item={i} variant="side" />
        ))}
      </nav>
      <div className="mt-auto px-3 py-3">
        <p className="font-extrabold leading-snug">{nav.student ? firstName(nav.name) : nav.name}</p>
        <p className="text-sm text-ink-2">{nav.role}</p>
        <div className="-ml-2 mt-2 flex items-center gap-1">
          <AccountLink />
          <SignOutButton />
        </div>
      </div>
    </>
  );
}

async function BottomNav({ area }: { area: Area }) {
  const nav = await navFor(area);
  if (!nav) return null;
  return (
    <>
      {nav.items.map((i) => (
        <NavLink key={i.href} item={i} variant="bottom" />
      ))}
    </>
  );
}

async function SessionGuardLoader() {
  const timing = await getSessionTiming();
  return timing ? <SessionGuard timing={timing} /> : null;
}

async function MobileAccountActions() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex items-center">
      <AccountLink />
      <SignOutButton />
    </div>
  );
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-11" />
      ))}
    </div>
  );
}

export function AppShell({ area, children }: { area: Area; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="no-print sticky top-0 hidden h-dvh flex-col gap-8 px-4 py-7 lg:flex">
        <Brand />
        <Suspense fallback={<NavSkeleton />}>
          <SideNav area={area} />
        </Suspense>
      </aside>
      <header className="no-print flex items-center justify-between px-5 pt-5 lg:hidden">
        <Brand />
        <Suspense fallback={null}>
          <MobileAccountActions />
        </Suspense>
      </header>
      <main
        id="main"
        className="mx-auto w-full min-w-0 max-w-[1320px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8"
      >
        {children}
      </main>
      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-line bg-card px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 lg:hidden"
      >
        <Suspense fallback={null}>
          <BottomNav area={area} />
        </Suspense>
      </nav>
      <Suspense fallback={null}>
        <SessionGuardLoader />
      </Suspense>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[1.75rem] font-black leading-tight tracking-tight sm:text-[2rem]">{title}</h1>
        {description ? <p className="mt-1 max-w-[65ch] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
