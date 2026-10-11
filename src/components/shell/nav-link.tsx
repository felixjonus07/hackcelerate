"use client";
import {
  BookOpenCheck,
  ClipboardCheck,
  Columns3,
  FileBarChart,
  Gauge,
  ListChecks,
  Share2,
  SlidersHorizontal,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { NavItem } from "./nav-config";

const ICONS = {
  passport: BookOpenCheck,
  quests: ListChecks,
  whatif: SlidersHorizontal,
  sharing: Share2,
  approvals: ClipboardCheck,
  dashboard: Gauge,
  board: Columns3,
  audit: FileBarChart,
  students: Users,
  leaderboard: Trophy,
};

export function NavLink({ item, variant }: { item: NavItem; variant: "side" | "bottom" }) {
  const path = usePathname();
  const active = path === item.href || path.startsWith(`${item.href}/`);
  const Icon = ICONS[item.icon];
  if (variant === "bottom")
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "press flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-[0.72rem] font-bold",
          active ? "text-act" : "text-ink-2",
        )}
      >
        <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 2} />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "press flex items-center gap-3 rounded-field px-3.5 py-3 font-bold",
        active ? "bg-card text-ink shadow-card" : "text-ink-2 hover:bg-sand-2 hover:text-ink",
      )}
    >
      <Icon aria-hidden className={cn("size-[1.15rem]", active && "text-act")} strokeWidth={active ? 2.4 : 2} />
      {item.label}
    </Link>
  );
}
